'use strict';

import express from 'express';
import gplay from "google-play-scraper";
import path from 'path';
import qs from 'querystring';

const router = express.Router();

const toList = (apps) => ({ results: apps });

const buildUrl = (req, subpath) =>
  req.protocol + '://' + path.join(req.get('host'), req.baseUrl, subpath);

/* Index */
router.get('/', (req, res) =>
  res.json({
    apps: buildUrl(req, 'apps'),
    developers: buildUrl(req, 'developers'),
    categories: buildUrl(req, 'categories')
  }));

/* App search */
router.get('/apps/', function (req, res, next) {
  if (!req.query.q) {
    return next();
  }

  const opts = Object.assign({ term: req.query.q }, req.query);

  gplay.search(opts)
    .then(toList)
    .then(res.json.bind(res))
    .catch(next);
});

/* Search suggest */
router.get('/apps/', function (req, res, next) {
  if (!req.query.suggest) {
    return next();
  }

  const toJSON = (term) => ({
    term,
    url: buildUrl(req, '/apps/') + '?' + qs.stringify({ q: term })
  });

  gplay.suggest({ term: req.query.suggest })
    .then((terms) => terms.map(toJSON))
    .then(toList)
    .then(res.json.bind(res))
    .catch(next);
});

/* App list */
router.get('/apps/', function (req, res, next) {
  function paginate(apps) {
    const num = parseInt(req.query.num || '60');
    const start = parseInt(req.query.start || '0');

    if (start - num >= 0) {
      req.query.start = start - num;
      apps.prev = buildUrl(req, '/apps/') + '?' + qs.stringify(req.query);
    }

    if (start + num <= 500) {
      req.query.start = start + num;
      apps.next = buildUrl(req, '/apps/') + '?' + qs.stringify(req.query);
    }

    return apps;
  }

  gplay.list(req.query)
    .then(toList).then(paginate)
    .then(res.json.bind(res))
    .catch(next);
});

/* App detail*/
router.get('/apps/:appId', function (req, res, next) {
  const opts = Object.assign({ appId: req.params.appId }, req.query);
  gplay.app(opts)
    .then(res.json.bind(res))
    .catch(next);
});

/* Similar apps */
router.get('/apps/:appId/similar', function (req, res, next) {
  const opts = Object.assign({ appId: req.params.appId }, req.query);
  gplay.similar(opts)
    .then(toList)
    .then(res.json.bind(res))
    .catch(next);
});

/* Data Safety */
router.get('/apps/:appId/datasafety', function (req, res, next) {
  const opts = Object.assign({ appId: req.params.appId }, req.query);
  gplay.datasafety(opts)
    .then(toList)
    .then(res.json.bind(res))
    .catch(next);
});

/* App permissions */
router.get('/apps/:appId/permissions', function (req, res, next) {
  const opts = Object.assign({ appId: req.params.appId }, req.query);
  gplay.permissions(opts)
    .then(toList)
    .then(res.json.bind(res))
    .catch(next);
});

/* App reviews */
router.get('/apps/:appId/reviews', function (req, res, next) {
  function paginate(apps) {
    const page = parseInt(req.query.page || '0');

    const subpath = '/apps/' + req.params.appId + '/reviews/';
    if (page > 0) {
      req.query.page = page - 1;
      apps.prev = buildUrl(req, subpath) + '?' + qs.stringify(req.query);
    }

    if (apps.results.length) {
      req.query.page = page + 1;
      apps.next = buildUrl(req, subpath) + '?' + qs.stringify(req.query);
    }

    return apps;
  }

  const opts = Object.assign({ appId: req.params.appId }, req.query);
  gplay.reviews(opts)
    .then(toList)
    .then(paginate)
    .then(res.json.bind(res))
    .catch(next);
});

/* Apps by developer */
router.get('/developers/:devId/', function (req, res, next) {
  const opts = Object.assign({ devId: req.params.devId }, req.query);

  gplay.developer(opts)
    .then((apps) => ({
      devId: req.params.devId,
      apps
    }))
    .then(res.json.bind(res))
    .catch(next);
});

/* Apps by developer - only readable details (throws out apps that fail to fetch) */
router.get('/developers_only_readable_details/:devId/', async function (req, res, next) {
  const opts = Object.assign({ devId: req.params.devId }, req.query);
  const lang = opts.lang || 'en';
  const country = opts.country || 'us';

  try {
    // First get basic app list without fullDetail
    const basicOpts = { ...opts, fullDetail: false };
    const basicApps = await gplay.developer(basicOpts);
    
    if (!basicApps || !Array.isArray(basicApps) || basicApps.length === 0) {
      return res.json({ devId: req.params.devId, apps: [], failed: 0 });
    }

    // Fetch full details for each app, collect only successful ones
    const results = await Promise.all(
      basicApps.map(async (app) => {
        try {
          const details = await gplay.app({ appId: app.appId, lang, country });
          return { success: true, app: details };
        } catch (e) {
          return { success: false, appId: app.appId };
        }
      })
    );

    const successfulApps = results.filter(r => r.success).map(r => r.app);
    const failedCount = results.filter(r => !r.success).length;

    return res.json({ 
      devId: req.params.devId, 
      apps: successfulApps,
      failed: failedCount
    });
  } catch (err) {
    next(err);
  }
});

/* Apps by developer - best effort details (falls back to basic info on failure) */
router.get('/developers_best_effort_details/:devId/', async function (req, res, next) {
  const opts = Object.assign({ devId: req.params.devId }, req.query);
  const lang = opts.lang || 'en';
  const country = opts.country || 'us';

  try {
    // First get basic app list without fullDetail
    const basicOpts = { ...opts, fullDetail: false };
    const basicApps = await gplay.developer(basicOpts);
    
    if (!basicApps || !Array.isArray(basicApps) || basicApps.length === 0) {
      return res.json({ devId: req.params.devId, apps: [], fallbacks: 0 });
    }

    // Fetch full details for each app, fall back to basic info on failure
    const results = await Promise.all(
      basicApps.map(async (app) => {
        try {
          const details = await gplay.app({ appId: app.appId, lang, country });
          return { fullDetail: true, app: details };
        } catch (e) {
          return { fullDetail: false, app: app };
        }
      })
    );

    const apps = results.map(r => r.app);
    const fallbackCount = results.filter(r => !r.fullDetail).length;

    return res.json({ 
      devId: req.params.devId, 
      apps: apps,
      fallbacks: fallbackCount
    });
  } catch (err) {
    next(err);
  }
});

/* Developer list (not supported) */
router.get('/developers/', (req, res) =>
  res.status(400).json({
    message: 'Please specify a developer id.',
    example: buildUrl(req, '/developers/' + qs.escape('Wikimedia Foundation'))
  }));

/* Category list */
router.get('/categories/', function (req, res, next) {
  gplay.categories()
    .then(res.json.bind(res))
    .catch(next);
});


function errorHandler(err, req, res, next) {
  res.status(400).json({ message: err.message });
  next();
}

router.use(errorHandler);

export default router;
