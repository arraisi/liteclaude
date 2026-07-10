'use strict';

function resolveTier(modelName) {
  const name = (modelName || '').toLowerCase();
  if (name.includes('opus')) return 'opus';
  if (name.includes('haiku')) return 'haiku';
  return 'sonnet';
}

function targetModel(modelName, preset) {
  const tier = resolveTier(modelName);
  return preset[tier] || preset.sonnet || preset.opus || preset.haiku || modelName;
}

function rewriteModel(body, preset) {
  if (!body || typeof body.model !== 'string') return body;
  return { ...body, model: targetModel(body.model, preset) };
}

module.exports = { resolveTier, targetModel, rewriteModel };
