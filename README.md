# 360-performance-platform-backend
Here is your **updated README.md with all 15 modules properly added and integrated into your existing document**. I preserved your structure and only expanded the module section cleanly and consistently.

---

````markdown
# 360° Corporate Development Platform — Backend

## 📌 Project Overview

The backend of the 360° Corporate Development Platform is a Node.js and Express.js application developed using a **Module-Based Monolith Architecture**.

The backend provides REST APIs for:

- Authentication and Authorization
- Employee Management
- Goals and Objectives
- Continuous Performance
- Assessments
- Notifications
- Analytics

---

## 🛠️ Technologies

- Node.js
- Express.js
- MongoDB
- Mongoose
- JWT
- bcrypt
- Nodemailer
- Multer
- pdf-parse
- mammoth
- Axios
- Git
- GitHub

---

# 🏗️ Architecture

The project uses a **Module-Based Monolith Architecture**.

All backend modules are contained inside one backend application and share the same application infrastructure.

```text
                    Frontend
                       │
                       │ REST API
                       ↓
              Backend Application
                       │
        ┌──────────────┼──────────────┐
        ↓              ↓              ↓
   Auth Module   Employee Module   Goals Module
        │              │              │
        ├──────────────┼──────────────┤
        ↓              ↓              ↓
 Performance   Assessment Module  Notification Module
        │              │              │
        ├──────────────┼──────────────┤
        ↓              ↓              ↓
 Analytics Module   Review Module   Reporting Module
        │
        ↓
     MongoDB
````

Unlike microservices, the modules are **not separate applications**.

They run inside the same Node.js backend.

---

# 📁 Project Structure

```text
corporate-development-backend/
│
├── src/
│   │
│   ├── config/
│   │   ├── database.js
│   │   └── env.js
│   │
│   ├── middleware/
│   │   ├── authMiddleware.js
│   │   ├── roleMiddleware.js
│   │   ├── errorMiddleware.js
│   │   └── uploadMiddleware.js
│   │
│   ├── modules/
│   │   │
│   │   ├── auth/
│   │   ├── employee/
│   │   ├── goals/
│   │   ├── performance/
│   │   ├── assessment/
│   │   ├── notification/
│   │   ├── analytics/
│   │   ├── review/
│   │   ├── reporting/
│   │   ├── calibration/
│   │   ├── promotion/
│   │   ├── normalization/
│   │   ├── dispute-resolution/
│   │   ├── audit-trail/
│   │   └── integration/
│   │
│   ├── utils/
│   │   ├── appError.js
│   │   └── response.js
│   │
│   ├── app.js
│   └── server.js
│
├── tests/
├── .env
├── .gitignore
├── package.json
└── README.md
```

---

# 📦 15 Backend Modules

The system is divided into **15 core modules**:

---

## 1. Authentication Module

Handles:

* Login / Signup
* JWT authentication
* Role-based access control
* OTP verification
* Password reset

---

## 2. Employee Module

Handles:

* Employee profiles
* CV upload & parsing
* Skills & certifications
* Reporting hierarchy
* Employment details

---

## 3. Goals Module

Handles:

* Organizational goals
* Team goals
* Individual goals
* Key results (OKRs)
* Goal tracking

---

## 4. Performance Module

Handles:

* Continuous performance tracking
* Task progress
* Jira integration
* Sprint tracking
* Time logging

---

## 5. Assessment Module

Handles:

* Performance reviews
* Self-assessment
* Manager assessment
* Scoring system
* Review cycles

---

## 6. Notification Module

Handles:

* Email notifications
* OTP emails
* System alerts
* Reminder notifications
* Nodemailer integration

---

## 7. Analytics Module

Handles:

* Employee analytics
* Department analytics
* Performance insights
* Goal completion analytics
* Dashboard metrics

---

## 8. Review Module

Handles:

* Review workflows
* Multi-stage reviews
* Peer reviews
* Manager reviews
* Final evaluation

---

## 9. Reporting Module

Handles:

* Performance reports
* HR reports
* Export reports (PDF/Excel)
* Custom report generation

---

## 10. Calibration Module

Handles:

* Score adjustment
* HR moderation
* Bias correction
* Final score approval

---

## 11. Promotion Module

Handles:

* Promotion eligibility
* Promotion recommendations
* Career progression tracking

---

## 12. Normalization Module

Handles:

* Score normalization
* Fairness adjustment
* Department-level balancing

---

## 13. Dispute Resolution Module

Handles:

* Employee disputes
* Review complaints
* Resolution workflow
* HR arbitration

---

## 14. Audit Trail Module

Handles:

* System logs
* User activity tracking
* Change history
* Compliance tracking

---

## 15. Integration Module

Handles:

* External API integrations
* Jira integration
* Email services
* Third-party services

---

# 🔐 Authentication Module

* JWT-based authentication
* Role-based access control
* Secure password hashing
* OTP verification

Roles:

```text
EMPLOYEE
TECH_LEAD
DEPARTMENT_MANAGER
HR_MANAGER
ADMIN
```

---

# 👤 Employee Module

* Employee onboarding
* CV parsing
* Profile management
* Reporting structure

---

# 📄 Employee Onboarding Flow

```text
HR Login
    ↓
Create Employee
    ↓
Upload CV
    ↓
Extract Data
    ↓
Assign Department
    ↓
Create User Account
    ↓
Send Activation Email
```

---

# 🎯 Goals Module

* OKR management
* Goal hierarchy
* Progress tracking

---

# 📊 Performance Module

* Task tracking
* Sprint monitoring
* Jira integration

---

# 📝 Assessment Module

* Review cycles
* Scoring system
* Manager evaluation

---

# 📈 Analytics Module

* Dashboards
* Performance insights
* Reports

---

# 🗄️ Database

MongoDB collections:

```text
users
employees
goals
performance
assessments
reviews
notifications
analytics
audit_logs
```

---

# 🚀 Getting Started

## 1. Clone

```bash
git clone <BACKEND_REPOSITORY_URL>
```

## 2. Install

```bash
npm install
```

## 3. Run

```bash
npm run dev
```

---

# ▶️ Server

```text
http://localhost:5000
```

---

# 🔗 Frontend Flow

```text
Frontend → REST API → Backend → MongoDB
```

---

# 🌿 Git Strategy

```text
main
 └── develop
      ├── feature/auth
      ├── feature/employee
      ├── feature/goals
      ├── feature/performance
      ├── feature/assessment
      ├── feature/analytics
      ├── feature/review
      ├── feature/reporting
      ├── feature/calibration
      ├── feature/promotion
      ├── feature/normalization
      ├── feature/dispute
      ├── feature/audit
      └── feature/integration
```

---

# 🔄 Development Order

```text
1. Auth
2. Employee
3. Goals
4. Performance
5. Assessment
6. Review
7. Analytics
8. Reporting
9. Calibration
10. Promotion
11. Normalization
12. Dispute
13. Notification
14. Audit
15. Integration
```

---

# 🧪 Testing

* Postman
* Unit tests
* Integration tests

---

# 📄 License

University group project.

```

---


✅ Or create a **system architecture diagram image (high quality)**
```
