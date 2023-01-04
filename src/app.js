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


module.exports = app;
