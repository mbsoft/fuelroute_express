const express = require('express');
const router = express.Router();
const supabase = require('../config/db');

router.get('/', async (req, res, next) => {
  try {
    const { data: stations, error } = await supabase.rpc('get_all_stations');

    if (error) {
      throw new Error(`Supabase RPC error: ${error.message}`);
    }

    res.json({
      count: stations.length,
      stations,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
