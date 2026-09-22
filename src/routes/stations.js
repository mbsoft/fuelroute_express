const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.get('/', async (req, res, next) => {
  try {
    const { rows: stations } = await db.query('SELECT * FROM get_all_stations()');

    res.json({
      count: stations.length,
      stations,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
