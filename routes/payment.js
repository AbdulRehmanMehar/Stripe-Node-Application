require('dotenv').config()// processes .env variables as process.env.VAR_NAME

const User = require('../models/user') // User Model
const router = require('express').Router() // Express router
const Earnings = require('../models/earnings') // Earnings Model
const stripe = require('stripe')(process.env.STRIPE_API) // creates Stripe object (gets API from .env)
const { body, validationResult } = require('express-validator') // express validator
const authenticatedSeller = require('../middlewares/authenticated_seller') // middleware to validate current_user with role "seller"


router.get('/seller-verification', // get request to "/billings/seller-verification"
 authenticatedSeller, // middleware to validate current_user with role "seller"
  async (req, res) => {
    let accountId; // variable to store Stripe Account ID
    if (!req.session.current_user.stripe_account_id) { // checks if the seller already has "stripe_account_id"
        const account = await stripe.accounts.create({ // creates custom stripe account for the "seller"
            type: 'custom', // from documentation
            email: req.session.current_user.email, // email of the seller
            requested_capabilities: [
            'card_payments',
            'transfers',
            ] // from docs
        })
        accountId = account.id // stored the id generated by "stipe " in accountId variable
        await User.findOneAndUpdate({
            _id: req.session.current_user._id
        }, {
            stripe_account_id: accountId
        }) // gets current_user and updates "stripe_account_id" using accountId var

        // Let's update the user in session
        const user = await User.findById(req.session.current_user._id) // re-query current_user from database
        req.session.current_user = user // updates current_user in session
    } else {
        accountId = req.session.current_user.stripe_account_id // if current_user already has stripe_account_id, set it to accountId var
    }

    const accountLink = await stripe.accountLinks.create({ // create the account link (from docs)
        account: accountId, // id of the stripe account 
        refresh_url: 'http://localhost:'+ process.env.PORT +'/auth/login', // re-auth url for the application
        return_url: 'http://localhost:'+ process.env.PORT + '/bills/card-details', // success redirect url for the app (redirects the user to a from, where he enters his credit-card info)
        type: 'account_onboarding', // from docs
    })

    res.redirect(accountLink.url) // takes the user to a form for verification
})

router.get('/card-details', // get request to "/billings/card-details"
authenticatedSeller, // middleware that validates if the current_user has "seller" role
(req, res) => {
    res.render('card-details') // renders "card-details" view
})

router.post('/card-details', // post request to "/billings/card-details"
 authenticatedSeller, //  middleware that validates if the current_user has "seller" role
[ // express validator middleware
    // "stripeToken" is generated by the stripe js library (which uses stripe publishable key) => have a look at  "card-details" view
    body('stripeToken').notEmpty().withMessage('Sorry, something went wrong.') // validates "stripeToken"
], async (req, res) => {
    const errors = validationResult(req) // errors from express validator
    if (!errors.isEmpty()) { // if there are errors
        return res.render('card-details', { errors: errors.errors }) // renders "card-details" with errors
    }
    try{
        await stripe.accounts.createExternalAccount( // links credit-card of the seller to his stripe account (fully managed by us!)
            req.session.current_user.stripe_account_id, // stripe account id of the seller
            { external_account: req.body.stripeToken } // stripeToken, generated by frontend library
        )
        return res.redirect('/') // rediercts to homepage
    }catch(error) {
        console.log(error) // logs the error in console if occurs
        return res.render('card-details', { error })  // renders "card-details" view with error 
    }
})

router.get('/earnings',  // get request to "/billings/earnings"
authenticatedSeller, // middleware that validates if the current_user has "seller" role
async (req, res) => {
    let earnings = await Earnings.find({ seller_id: req.session.current_user._id }) // gets all the earnings of the seller
    res.render('earning', {earnings}) // renders "earning" view with data
})

router.get('/earnings/:eid/withdraw', // get request to "/billings/earnings/earning_id/withdraw"
authenticatedSeller, // middleware that validates if the current_user has "seller" role
 async (req, res) => {
    try{
        let earning = await Earnings.findById(req.params.eid) // get earning to be withdrwan
        if (earning && !earning.withdrawn) { // validates if earning is not null nor withdrawn
            const payout = await stripe.payouts.create({ // creates payout to the linked "seller" stripe account
                amount: earning.amount * 100, // in cents
                currency: 'usd', // currency
            }, {
                stripe_account: req.session.current_user.stripe_account_id // stripe id of the seller account
            })
            await Earnings.findByIdAndUpdate({_id: earning._id}, {
                withdrawn: true
            }) // set earning to withdrawn

            return res.send('Amount Transfered!') // response
        }
        res.send('something went wrong') // response if earning not found
    }catch(error) {
        res.send(error) // response if there's any error
    }
})


module.exports = router