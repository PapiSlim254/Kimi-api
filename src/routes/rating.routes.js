const express = require('express');
const router = express.Router();
const ratingController = require('../controllers/rating.controller');
const { authenticate } = require('../middleware/authenticate');
const { validate } = require('../middleware/validate');
const { createRatingSchema } = require('../validators');

router.post('/', authenticate, validate(createRatingSchema), ratingController.createRating);
router.get('/driver/:driverId', authenticate, ratingController.getDriverRatings);

module.exports = router;
