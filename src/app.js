const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model')
const {getProfile} = require('./middleware/getProfile')
const {Op} = require('sequelize');
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

const getBelongsToKey = (profile) => profile.type === 'client' ? 'ClientId' : 'ContractorId'

/**
 * Return the contract with the specified id that belongs to the profile, uses the key depending on the profile type
 * @returns contract by id
 */
app.get('/contracts/:id',getProfile ,async (req, res) =>{
    const {Contract} = req.app.get('models')
    const {id} = req.params
    const {profile} = req
    const belongToKey = getBelongsToKey(profile)

    const contract = await Contract.findOne({where: { id, [belongToKey]: profile.id}})
    if(!contract) return res.status(404).end()
    res.json(contract)
})

/**
 * Return all contracts that belongs to the profile, uses the key depending on the profile type
 * @returns contracts
 */
app.get('/contracts',getProfile, async (req, res) => {
    const {Contract} = req.app.get('models')
    const {profile} = req
    const belongToKey = getBelongsToKey(profile)
    const contracts = await Contract.findAll({where: {
        [belongToKey]: profile.id,
        status: {[Op.not]: 'terminated'}
    }})
    res.json(contracts)
})

/**
 * Return all unpaid jobs that belongs any of the profile contracts
 * @returns jobs
 */
app.get('/jobs/unpaid',getProfile, async (req, res) => {
    const {Job, Contract} = req.app.get('models')
    const {profile} = req
    const belongToKey = getBelongsToKey(profile)
    const contracts = await Contract.findAll({
        attributes: ['id'],
        where: {
            [belongToKey]: profile.id,
            status: 'in_progress'
        }
    })
    const contractIds = contracts.map((contract) => contract.id);
    const jobs = await Job.findAll({where: {
        ContractId: contractIds,
        paid: {[Op.not]: true}
    }})
    res.json(jobs)
})


/**
 * Pays the specified job of the current client
 * @returns operation success status { success: true|false, message: 'if true', error: 'if false'}
 */
app.post('/jobs/:job_id/pay',getProfile, async(req, res) => {
    const {profile} = req
    if(profile.type !== 'client') {
        res.json({success: false, error: 'Only clients can pay for jobs'});
        return;
    }
    const {job_id} = req.params
    const {Job} = req.app.get('models')
    const jobToPay = await Job.findOne({where: {id: job_id}})
    if(jobToPay.paid) {
        res.json({success: false, error: 'This job was already paid'})
        return;
    }
    const jobContract = await jobToPay.getContract({include: 'Contractor'})
    const profileIsCliente = await profile.hasClient(jobContract);
    if(!profileIsCliente) {
        res.json({success: false, error: 'You are not the client of this job'})
        return;
    }
    const canPay = profile.balance >= jobToPay.price
    if(!canPay) {
        res.json({success: false, error: 'Your balance is not enought to pay for this job'})
        return;
    }
    profile.balance -= jobToPay.price;
    await profile.save()
    jobContract.Contractor.balance += jobToPay.price;
    await jobContract.Contractor.save()
    jobToPay.paid = true
    jobToPay.paymentDate = new Date().toISOString()
    await jobToPay.save()
    res.json({status: true, message: 'Job paid successfully'})
})

app.post('/balances/deposit/:userId', async (req, res) => {
    res.status(404).end()
})

/**
 * Gets the best paid profession for the specified date range
 * @returns profession and amount {	"profession": "Programmer", "amountPaid": 2483 }
 */
app.get('/admin/best-profession', async (req, res) => {
    const {Job, Contract} = req.app.get('models')
    const {start, end} = req.query
    if(start == null || end == null) {
        res.status(400).json({error: 'Missing start or end date query parameters'})
        return
    }
    const jobsInRange = await Job.findAll({where: { paymentDate: { [Op.between]: [start, end] }}})
    if(jobsInRange.length === 0) {
        res.status(404).json({error: 'No job found for specified range'})
        return
    }

    const contractIds = [...new Set(jobsInRange.map((job) => job.ContractId))]
    const contractsInRange = await Contract.findAll({
        where: {id: contractIds },
        include: 'Contractor'
    })
    const contractPaidSummary = jobsInRange.reduce((summary, job) => {
        if(!summary.hasOwnProperty(job.ContractId)) {
            summary[job.ContractId] = 0
        }
        summary[job.ContractId] += job.price
        return summary
    }, {})
    const professionPaidSummary = contractsInRange.reduce((summary, contract) => {
        if(!summary.hasOwnProperty(contract.Contractor.profession)) {
            summary[contract.Contractor.profession] = 0
        }
        summary[contract.Contractor.profession] += contractPaidSummary[contract.id]
        return summary
    }, {})
    const sortedEntries = Object.entries(professionPaidSummary).sort((obj1, obj2) => {
        return obj2[1] - obj1[1]
    })
    
    const bestPaidProfession = sortedEntries[0]
    res.json({profession: bestPaidProfession[0], amountPaid: bestPaidProfession[1]})
})

/**
 * Gets up to limit most paying clients for specified date range
 * @returns array of objects with client id, fullname and paid amount. Example:
 * [
	{
		"id": 4,
		"fullname": "Ash Kethcum",
		"paid": 2020
	},
	{
		"id": 1,
		"fullname": "Harry Potter",
		"paid": 242
	},
 */
app.get('/admin/best-clients', async (req, res) => {
    const {Job, Contract} = req.app.get('models')
    const {start, end} = req.query
    if(start == null || end == null) {
        res.status(400).json({error: 'Missing start or end date query parameters'})
        return
    }
    const limit = req.query.limit ?? 2 // default limit, add to constants file
    const jobsInRange = await Job.findAll({where: { paymentDate: { [Op.between]: [start, end] }}})
    
    if(jobsInRange.length === 0) {
        res.status(404).json({error: 'No job found for specified range'})
        return
    }

    const contractIds = [...new Set(jobsInRange.map((job) => job.ContractId))]
    const contractsInRange = await Contract.findAll({
        where: {id: contractIds },
        include: 'Client'
    })
    const contractPaidSummary = jobsInRange.reduce((summary, job) => {
        if(!summary.hasOwnProperty(job.ContractId)) {
            summary[job.ContractId] = 0
        }
        summary[job.ContractId] += job.price
        return summary
    }, {})
    const clientsPaidSummary = contractsInRange.reduce((summary, contract) => {
        if(!summary.hasOwnProperty(contract.Client.id)) {
            summary[contract.Client.id] = {id: contract.Client.id, fullname: contract.Client.getFullName(), paid: 0}
        }
        summary[contract.Client.id].paid += contractPaidSummary[contract.id]
        return summary
    }, {})
    const sortedEntries = Object.entries(clientsPaidSummary).sort((obj1, obj2) => {
        return obj2[1].paid - obj1[1].paid
    })

    const result = Object.values(sortedEntries).slice(0, limit).map((entry) => entry[1])
    res.json(result)
})


module.exports = app;
