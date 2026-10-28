import {
  pgTable, serial, text, integer, boolean, timestamp, date, numeric, jsonb, uniqueIndex, pgEnum,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["ADMIN", "HR", "MANAGER", "EMPLOYEE"]);
export const requestTypeEnum = pgEnum("request_type", ["LEAVE", "WFH", "EXPENSE", "PUNCH", "TICKET"]);
export const requestStatusEnum = pgEnum("request_status", ["PENDING", "APPROVED", "REJECTED", "CANCELLED"]);
export const stageEnum = pgEnum("candidate_stage", ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED"]);

const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: "number" });

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  currency: text("currency").notNull().default("PKR"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 4, mode: "number" }).notNull().default(0.05),
  workingDaysPerMonth: integer("working_days_per_month").notNull().default(22),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One sign-in identity. A person has one account and an employee record (users row) in each company they belong to. */
export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
});

const companyId = () => integer("company_id").notNull().references(() => companies.id);

export const departments = pgTable("departments", {
  id: serial("id").primaryKey(),
  companyId: companyId(),
  name: text("name").notNull(),
}, (t) => [uniqueIndex("departments_company_name").on(t.companyId, t.name)]);

export const shifts = pgTable("shifts", {
  id: serial("id").primaryKey(),
  companyId: companyId(),
  name: text("name").notNull(),
  startTime: text("start_time").notNull(), // "HH:MM"
  endTime: text("end_time").notNull(),
  graceMinutes: integer("grace_minutes").notNull().default(15),
});

/** An employee record: one per person per company. All HR data hangs off this id, which keeps companies isolated. */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  companyId: companyId(),
  accountId: integer("account_id").notNull().references(() => accounts.id),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: roleEnum("role").notNull().default("EMPLOYEE"),
  title: text("title").notNull().default(""),
  phone: text("phone").notNull().default(""),
  departmentId: integer("department_id").references(() => departments.id),
  managerId: integer("manager_id"),
  shiftId: integer("shift_id").references(() => shifts.id),
  joinDate: date("join_date").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("users_company_email").on(t.companyId, t.email), uniqueIndex("users_account_company").on(t.accountId, t.companyId)]);

export const holidays = pgTable("holidays", {
  id: serial("id").primaryKey(),
  companyId: companyId(),
  date: date("date").notNull(),
  name: text("name").notNull(),
}, (t) => [uniqueIndex("holidays_company_date").on(t.companyId, t.date)]);

export const attendance = pgTable("attendance", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  date: date("date").notNull(),
  checkIn: timestamp("check_in", { withTimezone: true }),
  checkOut: timestamp("check_out", { withTimezone: true }),
  breakMinutes: integer("break_minutes").notNull().default(0),
  breakStartedAt: timestamp("break_started_at", { withTimezone: true }),
  late: boolean("late").notNull().default(false),
  source: text("source").notNull().default("web"),
}, (t) => [uniqueIndex("attendance_user_date").on(t.userId, t.date)]);

export const leaveTypes = pgTable("leave_types", {
  id: serial("id").primaryKey(),
  companyId: companyId(),
  name: text("name").notNull(),
  annualQuota: numeric("annual_quota", { precision: 5, scale: 1, mode: "number" }).notNull(),
  paid: boolean("paid").notNull().default(true),
}, (t) => [uniqueIndex("leave_types_company_name").on(t.companyId, t.name)]);

export const leaveBalances = pgTable("leave_balances", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  leaveTypeId: integer("leave_type_id").notNull().references(() => leaveTypes.id),
  year: integer("year").notNull(),
  allotted: numeric("allotted", { precision: 5, scale: 1, mode: "number" }).notNull(),
  used: numeric("used", { precision: 5, scale: 1, mode: "number" }).notNull().default(0),
}, (t) => [uniqueIndex("leave_balance_uniq").on(t.userId, t.leaveTypeId, t.year)]);

export const requests = pgTable("requests", {
  id: serial("id").primaryKey(),
  type: requestTypeEnum("type").notNull(),
  userId: integer("user_id").notNull().references(() => users.id),
  status: requestStatusEnum("status").notNull().default("PENDING"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  days: numeric("days", { precision: 5, scale: 1, mode: "number" }),
  leaveTypeId: integer("leave_type_id").references(() => leaveTypes.id),
  amount: money("amount"),
  category: text("category"),
  punchIn: text("punch_in"),
  punchOut: text("punch_out"),
  subject: text("subject"),
  reason: text("reason").notNull().default(""),
  approverId: integer("approver_id").references(() => users.id),
  decisionNote: text("decision_note"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  payslipId: integer("payslip_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const requestComments = pgTable("request_comments", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull().references(() => requests.id),
  userId: integer("user_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  category: text("category").notNull(),
  url: text("url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assets = pgTable("assets", {
  id: serial("id").primaryKey(),
  companyId: companyId(),
  tag: text("tag").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  assignedTo: integer("assigned_to").references(() => users.id),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
}, (t) => [uniqueIndex("assets_company_tag").on(t.companyId, t.tag)]);

export const onboardingTasks = pgTable("onboarding_tasks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  done: boolean("done").notNull().default(false),
});

export const salaryStructures = pgTable("salary_structures", {
  userId: integer("user_id").primaryKey().references(() => users.id),
  basic: money("basic").notNull(),
  allowances: money("allowances").notNull().default(0),
  deductions: money("deductions").notNull().default(0),
});

export const payrollRuns = pgTable("payroll_runs", {
  id: serial("id").primaryKey(),
  companyId: companyId(),
  month: text("month").notNull(), // YYYY-MM
  finalized: boolean("finalized").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("payroll_runs_company_month").on(t.companyId, t.month)]);

export const payslips = pgTable("payslips", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => payrollRuns.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id),
  basic: money("basic").notNull(),
  allowances: money("allowances").notNull(),
  reimbursements: money("reimbursements").notNull(),
  unpaidLeaveDays: numeric("unpaid_leave_days", { precision: 5, scale: 1, mode: "number" }).notNull(),
  unpaidLeaveDeduction: money("unpaid_leave_deduction").notNull(),
  deductions: money("deductions").notNull(),
  tax: money("tax").notNull(),
  gross: money("gross").notNull(),
  net: money("net").notNull(),
}, (t) => [uniqueIndex("payslip_run_user").on(t.runId, t.userId)]);

export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  companyId: companyId(),
  title: text("title").notNull(),
  departmentId: integer("department_id").references(() => departments.id),
  location: text("location").notNull().default("Onsite"),
  description: text("description").notNull().default(""),
  open: boolean("open").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const candidates = pgTable("candidates", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobs.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  stage: stageEnum("stage").notNull().default("APPLIED"),
  rating: integer("rating"),
  notes: text("notes").notNull().default(""),
  hiredUserId: integer("hired_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const goals = pgTable("goals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  progress: integer("progress").notNull().default(0),
  dueDate: date("due_date"),
});

export const reviewCycles = pgTable("review_cycles", {
  id: serial("id").primaryKey(),
  companyId: companyId(),
  name: text("name").notNull(),
  open: boolean("open").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  cycleId: integer("cycle_id").notNull().references(() => reviewCycles.id),
  userId: integer("user_id").notNull().references(() => users.id),
  selfRating: integer("self_rating"),
  selfComment: text("self_comment"),
  managerRating: integer("manager_rating"),
  managerComment: text("manager_comment"),
}, (t) => [uniqueIndex("review_cycle_user").on(t.cycleId, t.userId)]);

export const courses = pgTable("courses", {
  id: serial("id").primaryKey(),
  companyId: companyId(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  hours: integer("hours").notNull().default(1),
});

export const enrollments = pgTable("enrollments", {
  id: serial("id").primaryKey(),
  courseId: integer("course_id").notNull().references(() => courses.id),
  userId: integer("user_id").notNull().references(() => users.id),
  progress: integer("progress").notNull().default(0),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [uniqueIndex("enrollment_uniq").on(t.courseId, t.userId)]);

export const announcements = pgTable("announcements", {
  id: serial("id").primaryKey(),
  companyId: companyId(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  authorId: integer("author_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const kudos = pgTable("kudos", {
  id: serial("id").primaryKey(),
  fromId: integer("from_id").notNull().references(() => users.id),
  toId: integer("to_id").notNull().references(() => users.id),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const surveys = pgTable("surveys", {
  id: serial("id").primaryKey(),
  companyId: companyId(),
  question: text("question").notNull(),
  options: jsonb("options").$type<string[]>().notNull(),
  active: boolean("active").notNull().default(true),
});

export const surveyVotes = pgTable("survey_votes", {
  id: serial("id").primaryKey(),
  surveyId: integer("survey_id").notNull().references(() => surveys.id),
  userId: integer("user_id").notNull().references(() => users.id),
  optionIndex: integer("option_index").notNull(),
}, (t) => [uniqueIndex("survey_vote_uniq").on(t.surveyId, t.userId)]);

export const activity = pgTable("activity", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  icon: text("icon").notNull().default("bell"),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
