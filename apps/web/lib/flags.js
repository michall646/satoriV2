// Feature flags for UI that is not real yet. Flip to true only when the server side ships.
// Keep this file tiny and dependency-free so server/client components can read it.
'use strict';

const FLAGS = {
  // authoring
  customChecker: false,
  validators: false,
  testManager: false,
  polygonImport: false,
  pdfImport: false,
  editorial: false,
  // judge / contest
  asyncJudge: false,
  examEnforcement: false,
  teamMode: false,
  freezeReplay: false,
  // course / comms
  gradebook: false,
  announcementsEmail: false,
  notificationsEmail: false,
  integrityMoss: false,
  // platform
  pwa: false,
  orgAdmin: false,
  cliRefresh: false,
};

function isEnabled(name, fallback = false) {
  return Object.prototype.hasOwnProperty.call(FLAGS, name) ? Boolean(FLAGS[name]) : fallback;
}

module.exports = { FLAGS, isEnabled };
