'use strict';

module.exports = function setup(c) {

  // The new search (backend/search): candidates before research, matched however the buyer typed. SEARCH_V2=shadow (default) runs it
  // silently beside every research request and keeps the comparison for the admin; =on lets the page show candidates; =off stops it.
  const SEARCH = require('../search/service').createSearch({ env: process.env });
  Object.assign(c, { SEARCH });
};
