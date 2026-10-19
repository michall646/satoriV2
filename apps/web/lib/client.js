// Satori V2 web — compatibility facade. New code imports api/i18n/verdict directly.
module.exports = {
  ...require('./api'),
  ...require('./i18n'),
  ...require('./verdict'),
};
