import type { DB } from "@/db";
import type { Actor } from "./core";
import * as people from "./people";
import * as att from "./attendance";
import * as req from "./requests";
import * as pay from "./payroll";
import * as talent from "./talent";
import * as admin from "./admin";

type Fn = (db: DB, actor: Actor, ...args: any[]) => Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Everything the browser may call. Each function enforces its own permissions. */
export const actions: Record<string, Fn> = {
  // account
  changePassword: (db, a, cur, next) => people.changePassword(db, a, cur, next),
  // people
  createEmployee: (db, a, input) => people.createEmployee(db, a, input),
  updateEmployee: (db, a, id, patch) => people.updateEmployee(db, a, id, patch),
  setActive: (db, a, id, on) => people.setActive(db, a, id, on),
  addDocument: (db, a, uid, title, cat, url) => people.addDocument(db, a, uid, title, cat, url),
  deleteDocument: (db, a, id) => people.deleteDocument(db, a, id),
  createAsset: (db, a, tag, name, cat) => people.createAsset(db, a, tag, name, cat),
  assignAsset: (db, a, id, uid) => people.assignAsset(db, a, id, uid),
  toggleTask: (db, a, id) => people.toggleTask(db, a, id),
  addTask: (db, a, uid, title) => people.addTask(db, a, uid, title),
  // time
  checkIn: (db, a) => att.checkIn(db, a),
  checkOut: (db, a) => att.checkOut(db, a),
  startBreak: (db, a) => att.startBreak(db, a),
  endBreak: (db, a) => att.endBreak(db, a),
  createShift: (db, a, n, s, e, g) => att.createShift(db, a, n, s, e, g),
  assignShift: (db, a, ids, sid) => att.assignShift(db, a, ids, sid),
  // requests
  applyLeave: (db, a, i) => req.applyLeave(db, a, i),
  applyWfh: (db, a, i) => req.applyWfh(db, a, i),
  applyExpense: (db, a, i) => req.applyExpense(db, a, i),
  applyPunch: (db, a, i) => req.applyPunch(db, a, i),
  openTicket: (db, a, i) => req.openTicket(db, a, i),
  commentOnTicket: (db, a, id, body) => req.commentOnTicket(db, a, id, body),
  decide: (db, a, id, ok, note) => req.decide(db, a, id, ok, note),
  cancelRequest: (db, a, id) => req.cancel(db, a, id),
  // payroll
  setSalary: (db, a, uid, b, al, de) => pay.setSalary(db, a, uid, b, al, de),
  runPayroll: (db, a, month) => pay.runPayroll(db, a, month),
  finalizeRun: (db, a, id) => pay.finalizeRun(db, a, id),
  finalSettlement: (db, a, uid, day) => pay.finalSettlement(db, a, uid, day),
  // recruitment
  createJob: (db, a, i) => talent.createJob(db, a, i),
  setJobOpen: (db, a, id, open) => talent.setJobOpen(db, a, id, open),
  moveCandidate: (db, a, id, stage) => talent.moveCandidate(db, a, id, stage),
  rateCandidate: (db, a, id, r, n) => talent.rateCandidate(db, a, id, r, n),
  hireCandidate: (db, a, id, pw, basic) => talent.hireCandidate(db, a, id, pw, basic),
  // performance
  addGoal: (db, a, uid, title, due) => talent.addGoal(db, a, uid, title, due),
  updateGoalProgress: (db, a, id, p) => talent.updateGoalProgress(db, a, id, p),
  createCycle: (db, a, name) => talent.createCycle(db, a, name),
  closeCycle: (db, a, id) => talent.closeCycle(db, a, id),
  submitSelfReview: (db, a, id, r, c) => talent.submitSelfReview(db, a, id, r, c),
  submitManagerReview: (db, a, id, r, c) => talent.submitManagerReview(db, a, id, r, c),
  // training
  createCourse: (db, a, t, d, h) => talent.createCourse(db, a, t, d, h),
  enroll: (db, a, cid, uid) => talent.enroll(db, a, cid, uid),
  setCourseProgress: (db, a, cid, p) => talent.setCourseProgress(db, a, cid, p),
  // engagement
  postAnnouncement: (db, a, t, b) => talent.postAnnouncement(db, a, t, b),
  giveKudos: (db, a, to, m) => talent.giveKudos(db, a, to, m),
  createSurvey: (db, a, q, o) => talent.createSurvey(db, a, q, o),
  vote: (db, a, id, i) => talent.vote(db, a, id, i),
  closeSurvey: (db, a, id) => talent.closeSurvey(db, a, id),
  // admin
  addLeaveType: (db, a, n, q, p) => admin.addLeaveType(db, a, n, q, p),
  addHoliday: (db, a, d, n) => admin.addHoliday(db, a, d, n),
  removeHoliday: (db, a, id) => admin.removeHoliday(db, a, id),
  addDepartment: (db, a, n) => admin.addDepartment(db, a, n),
  updateSettings: (db, a, p) => admin.updateSettings(db, a, p),
  createCompany: (db, a, name) => admin.createCompany(db, a, name),
  // reads needing live data
  ticketComments: async (db, a, id) => { await req.getRequest(db, a, id); return req.ticketComments(db, id); },
  surveyResults: (db, a, id) => talent.surveyResults(db, a.companyId, id),
  viewPayslip: (db, a, id) => pay.getPayslip(db, a, id),
};
