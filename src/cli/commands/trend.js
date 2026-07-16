import { register } from '../router.js';
import * as core from '../../core/trend.js';

register('trend', {
  description: 'Compute trend direction/strength/structure from price data (EMA slope + ADX/DMI + swing structure) — no indicators required on chart',
  options: {
    count: { type: 'string', short: 'n', description: 'Number of bars to analyze (default 150, min 60)' },
  },
  handler: (opts) => core.getTrendSummary({ count: opts.count ? Number(opts.count) : undefined }),
});
