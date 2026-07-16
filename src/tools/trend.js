import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/trend.js';

export function registerTrendTools(server) {
  server.tool('data_get_trend_summary', 'Compute trend direction, strength, and swing structure for the current chart symbol/timeframe from raw price data — no indicators need to be on the chart. Combines EMA20/50 slope, ADX/DMI (trend strength, <20 = choppy/ranging), and HH/HL vs LH/LL swing structure into one verdict.', {
    count: z.coerce.number().optional().describe('Number of bars to analyze (default 150, min 60)'),
  }, async ({ count }) => {
    try { return jsonResult(await core.getTrendSummary({ count })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
