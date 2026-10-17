/** 2026-10-17: tests before the shift — create, import / export, start for chosen people, take it, report. */
import { beforeAll, describe, expect, it } from 'vitest';
import { MANAGER_ROLES, DIVISION_SCOPE_PREFIX, ROLE_PREFIX } from '../../src/shared/constants';
import { activateClient, Client, ownerClient, SENATOR } from './client';

let owner: Client;
let chef: Client;
let ania: Client;
let aniaId = '';
let bartek: Client;
let bartekId = '';
let cookId = '';
let testId = '';
let sessionId = '';
const L = `/api/admin/locations/${SENATOR}`;
const q = (text: string, opts: [string, boolean][], multi = false) => ({ text, ...(multi ? { multi } : {}), options: opts.map(([t, c]) => ({ text: t, correct: c })) });

beforeAll(async () => {
  owner = await ownerClient();
  const mk = async (firstName: string, position: string, pin: string) => {
    const e = await owner.post(`${L}/employees`, { firstName, lastName: 'Test', position });
    return { id: e.data.id as string, c: await activateClient(e.data.login, e.data.tempSecret, pin) };
  };
  ({ id: aniaId, c: ania } = await mk('Ania', 'waiter', '471953'));
  ({ id: bartekId, c: bartek } = await mk('Bartek', 'waiter', '582064'));
  cookId = (await mk('Celina', 'kitchen_hot', '693175')).id;
  const x = MANAGER_ROLES.head_chef;
  const m = await owner.post('/api/admin/managers', { firstName: 'Kuba', lastName: 'Testy', locationId: SENATOR, permissions: [...x.permissions, ...x.divisions.map((d) => DIVISION_SCOPE_PREFIX + d), ROLE_PREFIX + 'head_chef'] });
  chef = new Client();
  await chef.login(m.data.login, m.data.tempSecret);
  await chef.post('/api/auth/change-secret', { current: m.data.tempSecret, next: 'KubaTesty2026!x' });
});

describe('making tests', () => {
  it('create, settings, questions with one or several answers, validation', async () => {
    testId = (await owner.post(`${L}/tests`, { title: 'Menu — dania główne', positions: ['waiter'], timeLimitMin: 5, passScore: 50 })).data.id;
    expect(testId).toBeTruthy();
    expect((await owner.post(`/api/admin/tests/${testId}/questions`, q('Bez poprawnej', [['A', false], ['B', false]]))).data.error).toBe('question_no_correct');
    expect((await owner.post(`/api/admin/tests/${testId}/questions`, q('Jedna', [['A', true]]))).data.error).toBe('question_options_invalid');
    await owner.post(`/api/admin/tests/${testId}/questions`, q('Z czym podajemy stek?', [['Sos pieprzowy i frytki', true], ['Puree', false], ['Ryż', false]]));
    await owner.post(`/api/admin/tests/${testId}/questions`, q('Które dania są wegetariańskie?', [['Risotto z grzybami', true], ['Tatar', false], ['Sałatka z burratą', true]]));
    const r = await owner.get(`/api/admin/tests/${testId}`);
    expect(r.data.test).toMatchObject({ title: 'Menu — dania główne', timeLimitSec: 300, passScore: 50, positions: ['waiter'] });
    expect(r.data.questions).toHaveLength(2);
    expect(r.data.questions[1].multi).toBe(true); // two correct → several answers
    const list = (await owner.get(`${L}/tests`)).data.tests;
    expect(list.find((t: { id: string }) => t.id === testId)).toMatchObject({ questions: 2, editable: true });
  });

  it('import and export as JSON; a head chef sees and edits only kitchen tests', async () => {
    const bad = await owner.post(`${L}/tests/import`, { format: 'senator-tests', tests: [{ title: 'Zły', questions: [q('Bez opcji', [['A', true]])] }] });
    expect(bad.data).toMatchObject({ error: 'test_import_question', details: { test: 1, question: 1 } });
    const dry = await chef.post(`${L}/tests/import`, { format: 'senator-tests', dryRun: true, tests: [{ title: 'Kuchnia — przygotowanie', questions: [q('Temperatura chłodni?', [['0–4°C', true], ['8–10°C', false]])] }] });
    expect(dry.data.tests[0]).toMatchObject({ questions: 1, positions: ['kitchen'] });
    const imp = await chef.post(`${L}/tests/import`, { format: 'senator-tests', tests: [{ title: 'Kuchnia — przygotowanie', timeLimitMin: 3, questions: [q('Temperatura chłodni?', [['0–4°C', true], ['8–10°C', false]])] }] });
    expect(imp.status).toBe(201);
    const chefList = (await chef.get(`${L}/tests`)).data.tests;
    expect(chefList.map((t: { title: string }) => t.title)).toEqual(['Kuchnia — przygotowanie']);
    expect((await chef.put(`/api/admin/tests/${testId}`, { title: 'X' })).status).toBe(404);
    const ex = await owner.get(`/api/admin/tests/${testId}/export`);
    expect(ex.data.format).toBe('senator-tests');
    expect(ex.data.tests[0].questions[1]).toMatchObject({ multi: true });
    // round trip
    expect((await owner.post(`${L}/tests/import`, ex.data)).status).toBe(201);
  });
});

describe('a test before the shift', () => {
  it('start for chosen people; leaders only within their divisions', async () => {
    const cand = await owner.get(`/api/admin/tests/${testId}/candidates`);
    expect(cand.data.people.find((p: { id: string }) => p.id === aniaId)).toMatchObject({ matches: true });
    expect(cand.data.people.find((p: { id: string }) => p.id === cookId)).toMatchObject({ matches: false });
    expect((await owner.post(`/api/admin/tests/${testId}/sessions`, { userIds: [] })).data.error).toBe('test_people_required');
    const kitchenTest = (await chef.get(`${L}/tests`)).data.tests[0].id;
    expect((await chef.post(`/api/admin/tests/${kitchenTest}/sessions`, { userIds: [aniaId] })).status).toBe(403);
    const s = await owner.post(`/api/admin/tests/${testId}/sessions`, { userIds: [aniaId, bartekId], timeLimitMin: 5 });
    expect(s.status).toBe(201);
    sessionId = s.data.sessionId;
    expect((await ania.get('/api/tests/active')).data.active).toMatchObject({ title: 'Menu — dania główne', opened: false, questions: 2 });
    expect((await ania.get(`${L.replace('/admin', '')}/changes`)).data.areas.tests).toMatch(/^1\./);
  });

  it('the person opens it (timer starts), answers, hands in; sees score and mistakes', async () => {
    const act = (await ania.get('/api/tests/active')).data.active;
    const o = await ania.post(`/api/tests/attempts/${act.attemptId}/open`);
    expect(o.data.questions).toHaveLength(2);
    expect(o.data.deadlineAt - Date.now()).toBeGreaterThan(290_000);
    expect(JSON.stringify(o.data)).not.toContain('correct');
    const steak = o.data.questions.find((x: { text: string }) => x.text.startsWith('Z czym'));
    const veg = o.data.questions.find((x: { text: string }) => x.text.startsWith('Które'));
    const id = (qq: { options: { id: string; text: string }[] }, t: string) => qq.options.find((x) => x.text === t)!.id;
    await ania.put(`/api/tests/attempts/${act.attemptId}/answers`, { questionId: steak.id, optionIds: [id(steak, 'Sos pieprzowy i frytki')] });
    await ania.put(`/api/tests/attempts/${act.attemptId}/answers`, { questionId: veg.id, optionIds: [id(veg, 'Risotto z grzybami')] }); // one of two: wrong
    // reopening gives the same questions with the saved answers
    const again = await ania.post(`/api/tests/attempts/${act.attemptId}/open`);
    expect(Object.keys(again.data.answers)).toHaveLength(2);
    expect((await bartek.post(`/api/tests/attempts/${act.attemptId}/submit`)).status).toBe(404);
    const r = await ania.post(`/api/tests/attempts/${act.attemptId}/submit`);
    expect(r.data).toMatchObject({ score: 50, passed: true, correct: 1, total: 2 });
    expect(r.data.mistakes).toEqual([{ text: 'Które dania są wegetariańskie?', chosen: ['Risotto z grzybami'], correct: expect.arrayContaining(['Risotto z grzybami', 'Sałatka z burratą']) }]);
    expect((await ania.get('/api/tests/active')).data.active).toBeNull();
    expect((await ania.put(`/api/tests/attempts/${act.attemptId}/answers`, { questionId: steak.id, optionIds: [] })).data.error).toBe('test_closed');
  });

  it('live view, finishing for everyone, the report by person and by question', async () => {
    const live = await owner.get(`/api/admin/test-sessions/${sessionId}`);
    expect(live.data.session.live).toBe(true);
    expect(live.data.people.find((p: { userId: string }) => p.userId === bartekId)).toMatchObject({ status: 'assigned' });
    expect((await owner.post(`/api/admin/test-sessions/${sessionId}/finish`)).status).toBe(200);
    expect((await bartek.get('/api/tests/active')).data.active).toBeNull();
    const rep = await owner.get(`/api/admin/test-sessions/${sessionId}`);
    expect(rep.data.session.live).toBe(false);
    expect(rep.data.totals).toMatchObject({ people: 2, done: 1, abandoned: 1, avgScore: 50, passed: 1 });
    const a = rep.data.people.find((p: { userId: string }) => p.userId === aniaId);
    expect(a.answers.map((x: { ok: boolean }) => x.ok).sort()).toEqual([false, true]);
    expect(rep.data.questions[0]).toMatchObject({ text: 'Które dania są wegetariańskie?', okPct: 0, topWrong: 'Risotto z grzybami' });
    const sessions = (await owner.get(`${L}/test-sessions?testId=${testId}`)).data.sessions;
    expect(sessions[0]).toMatchObject({ id: sessionId, people: 2, done: 1, avg: 50, live: false });
  });

  it('edits keep old results; a test with results is hidden, not deleted', async () => {
    const r = await owner.get(`/api/admin/tests/${testId}`);
    const veg = r.data.questions.find((x: { text: string }) => x.text.startsWith('Które'));
    expect((await owner.put(`/api/admin/tests/questions/${veg.id}`, q('Które dania są bezmięsne?', [['Risotto', true], ['Tatar', false]]))).status).toBe(200);
    const rep = await owner.get(`/api/admin/test-sessions/${sessionId}`);
    expect(rep.data.questions.map((x: { text: string }) => x.text)).toContain('Które dania są wegetariańskie?');
    expect((await owner.req('DELETE', `/api/admin/tests/${testId}`)).status).toBe(200);
    expect((await owner.get(`${L}/tests`)).data.tests.some((t: { id: string }) => t.id === testId)).toBe(false);
    expect((await owner.get(`/api/admin/test-sessions/${sessionId}`)).status).toBe(200);
    expect((await ania.get(`${L}/tests`)).status).toBe(403);
  });
});
