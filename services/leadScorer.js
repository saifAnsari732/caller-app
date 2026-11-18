/**
 * Lead Scoring & Priority Engine (Requirement 8)
 * Automatically computes quality_score (0-100) and maps to Priority:
 * - Hot Lead (Score >= 75)
 * - Warm Lead (Score 50-74)
 * - Cold Lead (Score < 50)
 */

function computeLeadScore(lead, callHistory = []) {
  let score = 30; // Base score for any inbound lead

  if (!lead) return { score: 50, priority: 'Normal' };

  // 1. Meta form custom answers completeness (+20 max)
  if (lead.custom_fields) {
    let customCount = 0;
    if (typeof lead.custom_fields === 'object') {
      customCount = Object.keys(lead.custom_fields).length;
    }
    if (customCount >= 3) score += 20;
    else if (customCount > 0) score += 10;
  }

  // 2. Product / Course Interest (+15)
  if (lead.product_interest && lead.product_interest.trim().length > 2) {
    score += 15;
  }

  // 3. Location / City specified (+10)
  if (lead.city && lead.city.trim().length > 2) {
    score += 10;
  }

  // 4. Contact details quality: alternate phone (+10), valid email (+5)
  if (lead.alternate_mobile && lead.alternate_mobile.trim().length >= 10) {
    score += 10;
  }
  if (lead.email && lead.email.includes('@')) {
    score += 5;
  }

  // 5. Multiple enquiries / repeat lead (+20)
  if (lead.is_repeat_lead || (lead.submission_count && lead.submission_count > 1)) {
    score += 20;
  }

  // 6. Call interaction responsiveness
  const calls = Array.isArray(callHistory) ? callHistory : [];
  let hasConnected = false;
  let hasPositiveInterest = false;
  let unreachedAttempts = 0;

  for (const c of calls) {
    const st = (c.status || '').toLowerCase();
    const disp = (c.disposition || '').toLowerCase();
    const dur = c.duration || 0;

    if (dur > 30 || disp.includes('connected') || st.includes('contacted') || st.includes('qualified')) {
      hasConnected = true;
    }
    if (st.includes('interest') || disp.includes('interest') || disp.includes('callback') || st.includes('demo') || st.includes('payment')) {
      hasPositiveInterest = true;
    }
    if (['no answer', 'switched off', 'busy', 'number busy'].some(u => disp.includes(u) || st.includes(u))) {
      unreachedAttempts++;
    }
  }

  if (hasPositiveInterest) score += 25;
  else if (hasConnected) score += 15;

  // Penalty for multiple unreachable attempts (-5 each, max -20)
  score -= Math.min(20, unreachedAttempts * 5);

  // Status penalty / bonus
  const statusLower = (lead.status || '').toLowerCase();
  if (['interested', 'qualified', 'demo scheduled', 'payment pending'].some(s => statusLower.includes(s))) {
    score += 20;
  } else if (['converted', 'closed'].some(s => statusLower.includes(s))) {
    score += 30;
  } else if (['not interested', 'lost', 'rejected', 'wrong number', 'invalid'].some(s => statusLower.includes(s))) {
    score = Math.min(score, 20); // Cap lost leads low
  }

  // 7. Freshness factor
  if (lead.createdAt) {
    const ageHours = (Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60);
    if (ageHours < 2) score += 10;
    else if (ageHours < 24) score += 5;
    else if (ageHours > 168) score -= 10; // > 7 days old
  }

  // Bound score between 5 and 100
  score = Math.max(5, Math.min(100, Math.round(score)));

  // Map to Priority
  let priority = 'Warm Lead';
  if (score >= 75) {
    priority = 'Hot Lead';
  } else if (score < 50) {
    priority = 'Cold Lead';
  }

  return { score, priority };
}

module.exports = {
  computeLeadScore
};
