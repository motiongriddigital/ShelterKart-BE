'use strict';
const express = require('express');

const app = express();
const c = {};

// Shared services first, in dependency order; each adds what the rest need to the context `c`.
require('./services/core')(c);
require('./services/engines')(c);
require('./services/pricing')(c);
require('./services/registry')(c);
require('./middleware/limiters')(c);
require('./services/liveReports')(c);
require('./services/search')(c);

// Then the request pipeline, the feature modules, and last the error handler.
require('./middleware/pipeline').install(app, c);
for (const name of ['site', 'payments', 'admin', 'investigate', 'search', 'guides', 'research', 'responses', 'customResearch']) require('./modules/' + name)(app, c);
require('./middleware/errors').install(app, c);

module.exports = { app, c };
