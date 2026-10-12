// node tests/zhtime.test.js — 锚点 2026-10-12（周一）22:30 Asia/Shanghai
const { parse, resolveAnchor, fmt, prefilter } = require('../src/calendar/zhtime');
const A = Date.UTC(2026, 9, 12, 14, 30); // 22:30 +08
const SAT = Date.UTC(2026, 9, 17, 2, 0); // 2026-10-17 周六 10:00
let pass = 0, fail = 0;
const t = (id, cond, info) => { if (cond) { pass++; console.log('PASS', id); } else { fail++; console.log('FAIL', id, info || ''); } };
const p1 = (s, a = A) => parse(s, a)[0] || {};

let r = p1('明天下午3点开会'); t('T1', fmt(r.start) === '2026-10-13 15:00' && r.certainty === 'exact', JSON.stringify(r));
r = p1('周五前交方案'); t('T2', fmt(r.start) === '2026-10-16 18:00' && r.deadline, fmt(r.start));
r = p1('周五前交方案', SAT); t('T3', fmt(r.start) === '2026-10-23 18:00', fmt(r.start));
r = p1('下周三上午'); t('T4', fmt(r.start) === '2026-10-21 09:00' && r.certainty === 'approx', fmt(r.start) + r.certainty);
const a = p1('三点一刻'), b = p1('两点半');
t('T5', /15:15$/.test(fmt(a.start)) && /14:30$/.test(fmt(b.start)) && a.certainty === 'approx' && b.certainty === 'approx', fmt(a.start) + ' ' + fmt(b.start));
r = p1('10月20号下午2-4点评审'); t('T6', fmt(r.start) === '2026-10-20 14:00' && fmt(r.end) === '2026-10-20 16:00', fmt(r.start) + '~' + (r.end && fmt(r.end)));
r = p1('月底前'); t('T7', fmt(r.start) === '2026-10-30 18:00' && r.deadline, fmt(r.start));
r = p1('每周一早上9点站会'); t('T8', r.rrule === 'FREQ=WEEKLY;BYDAY=MO' && /09:00$/.test(fmt(r.start)), JSON.stringify(r));
r = p1('国庆节后'); t('T9', fmt(r.start).startsWith('2026-10-09'), fmt(r.start));
r = p1('美西时间周二10am'); t('T11', fmt(r.start) === '2026-10-14 01:00', fmt(r.start));
const cap = Date.UTC(2026, 9, 12, 14, 30);
const anchor = resolveAnchor('昨天 14:20', cap);
r = p1('明天交', anchor); t('T12', fmt(anchor) === '2026-10-11 14:20' && fmt(r.start).startsWith('2026-10-12'), fmt(anchor) + ' → ' + fmt(r.start));
// extra coverage
t('X1 下午三点半', fmt(p1('下午三点半').start) === '2026-10-13 15:30');
t('X2 今晚8点', fmt(p1('今晚8点').start) === '2026-10-12 20:00');
t('X3 后天上午10:30', fmt(p1('后天上午10:30').start) === '2026-10-14 10:30');
t('X4 2026年11月3日', fmt(p1('2026年11月3日').start).startsWith('2026-11-03'));
t('X5 3天后', fmt(p1('3天后').start).startsWith('2026-10-15'));
t('X6 本周五', fmt(p1('本周五').start).startsWith('2026-10-16'));
t('X7 每月15号', p1('每月15号').rrule === 'FREQ=MONTHLY;BYMONTHDAY=15');
t('X8 无时间', parse('今天天气不错吧', A).length === 1 && parse('随便聊聊', A).length === 0);
t('X9 prefilter', prefilter('周五前给你方案').has_time && prefilter('我来负责').has_commit && !prefilter('哈哈好的').has_time);
t('X10 3点到4点半', (() => { const x = p1('下午3点到4点半'); return fmt(x.start).endsWith('15:00') && fmt(x.end).endsWith('16:30'); })());
console.log(`\nzhtime: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
