# Daylo – AI Productivity Planner

> **Daylo** is an intelligent, adaptive productivity planner that protects your peak energy, autonomously time-blocks focus work, and recalculates your schedule when unexpected commitments arise.

---

## ✦ Key Features

- **Autonomous Time-Blocking & Urgency Scoring:** Daylo evaluates your tasks with a mathematical urgency formula:
  $$\text{Urgency Score} = \text{Deadline Proximity (40\%)} + \text{Importance Weight (30\%)} + \text{Effort \& Risk (30\%)}$$
- **Ashley AI Productivity Assistant:**
  - Conversational scheduling assistant powered by n8n workflow integrations and intelligent local fallbacks.
  - Ask what to work on next, plan your day in natural language, or adapt when urgent meetings pop up.
  - Multi-tier AI chat limits (Free: 60 mins/month, Pro: 300 mins/month, Premium: Unlimited).
- **Adaptive Rescheduling & One-Tap Approval:** When tasks run late or commitments conflict, Daylo flags missed blocks and proposes optimal alternate slots without creating calendar chaos.
- **Real-Time Cloud Synchronization:** Powered by Firebase Firestore with real-time snapshot listeners—any task rescheduled by Ashley or via automation instantly updates on your Dashboard and My Tasks view.
- **Google Calendar Integration:** Sync personal and team calendar events directly with your focus blocks.
- **Peak Performance Learning:** Daylo tracks your completion patterns, estimate bias, and focus windows to recommend ideal hours for deep work.
- **Responsive Mobile Experience:** Clean Figma-inspired UI with dedicated mobile navigation, quick task intake, and an optimized notification center.

---

## 🛠 Tech Stack

- **Frontend:** Vanilla TypeScript & Modern ES6 Modules, Vite, Tailwind CSS
- **Database & Auth:** Firebase Firestore (Real-time NoSQL) & Firebase Authentication (Google OAuth + Email/Password)
- **Automation / Workflow Engine:** n8n Webhooks (`founder-assistant`, `flowday-insights`, `flowday-contact`)
- **Calendar Integration:** Google Calendar API v3
- **Payment Integration:** Paystack checkout integration for Pro and Premium tier upgrades

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or later)
- npm or bun

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/daylo-planner.git
   cd daylo-planner
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Copy `.env.example` to `.env` and configure your Firebase and webhook parameters:
   ```bash
   cp .env.example .env
   ```

4. **Start the Development Server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

5. **Build for Production:**
   ```bash
   npm run build
   ```

---

## 📁 Project Structure

```text
├── app.js                   # Core application engine, UI views, state, and Ashley AI logic
├── firebase.js              # Firebase SDK configuration (Firestore & Auth)
├── firestore.rules          # Firestore database security rules
├── index.html               # Main application entry point & dashboard shell
├── admin.html               # Administrative webhook configuration portal
├── login.html               # Authentication login view
├── signup.html              # Account registration view
├── upgrade.html             # Pricing & plan comparison page
├── contact.html             # Support & feedback intake form
├── public/                  # Static brand assets, logos, and mockups
├── src/                     # Source styles and supplementary utilities
├── metadata.json            # AI Studio applet metadata & permissions
└── vite.config.ts           # Vite bundler configuration
```

---

## 🔒 Security & Privacy

- Daylo uses strict Firestore security rules requiring user authentication for task access (`uid == request.auth.uid`).
- Token refresh safeguards ensure webhook requests always send valid, unexpired Firebase JWTs.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
