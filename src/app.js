const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model')
const {getProfile} = require('./middleware/getProfile')
const {Op} = require('sequelize');
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

/**
 * Return contracts that belongs to the profile, uses the key depending on the profile type
 * @returns contract by id
 */
app.get('/contracts/:id',getProfile ,async (req, res) =>{
    const {Contract} = req.app.get('models')
    const {id} = req.params
    const {profile} = req
    const belongToKey = profile.type === 'client' ? 'ClientId' : 'ContractorId'

    const contract = await Contract.findOne({where: { id, [belongToKey]: profile.id}})
    if(!contract) return res.status(404).end()
    res.json(contract)
})
module.exports = app;
