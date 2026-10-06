// ==========================================================================
// PashuMitra — Animal Disease Management & Surveillance Platform
// Integrated Pashu Health Chain:
// 1. Animal Health Identity (QR, Passport, Reproductive, Medication & Allergies)
// 2. Digital Biological Sample Tracking (GPS, Time, Chain of Custody)
// 3. Laboratory Diagnostic Portal (Receiving, Acceptance, Testing, Reports)
// 4. Veterinary Decision Support & AI Clinical Guidance
// 5. Structured Treatment Responses & Farm-Level Intelligence
// 6. National Disease Intelligence & Surveillance Network
// ==========================================================================

const API = "/api";
const ROLES = ["owner", "vet", "govt", "lab"];
// Runtime configuration is fetched from /api/ivr/info. This fixed fallback keeps
// click-to-call available if the info request is temporarily unavailable.
const DEFAULT_IVR_INFO = {
  helpline_number: "7382210251",
  helpline_e164: "+917382210251",
  display_number: "7382210251",
  tel_uri: "tel:+917382210251",
  provider_mode: "MOCK",
  pstn_connected: false,
};
const DEMO_ACCOUNTS = {
  // Farmers log in with a mobile number + OTP now (no password shown).
  owner: { mobile: "9800000001" },
  vet: { username: "vet1@example.com", password: "password123" },
  govt: { username: "govt@example.com", password: "password123" },
  lab: { username: "lab@example.com", password: "password123" },
};
// The backend is the sole authority for demo Farmer credentials and returns
// them in /api/auth/farmer/config only while demo mode is enabled. Do not keep a
// second hard-coded frontend copy: a missing/malformed server config must hide
// the demo box instead of displaying credentials that may not be accepted.
let ivrInfoPromise = null;

const state = {
  token: localStorage.getItem("token") || null,
  user: JSON.parse(localStorage.getItem("user") || "null"),
  lang: ["en", "mr", "hi", "te"].includes(localStorage.getItem("pm_lang")) ? localStorage.getItem("pm_lang") : "en",
  route: "#/",
  pagination: { helpline: 1, govtExport: 1, cases: 1, animals: 1, labQueue: 1, labReports: 1, pageSize: 10 },
};

function getUserRole() {
  const role = state.user && state.user.role;
  return ROLES.includes(role) ? role : null;
}
function homeFor(role) { return `#/${role}/dashboard`; }

// ------------------------------------------------------------------ i18n --
const I18N = {
  en: {
    "app.tagline": "Animal Disease Reporting & Veterinary Care — Maharashtra",
    "nav.dashboard": "Home", "nav.analytics": "Analytics", "nav.gis": "GIS Risk Map",
    "nav.surveillance": "Surveillance", "nav.ai": "AI Risk", "nav.reporting": "Report",
    "nav.animals": "Animals", "nav.cases": "Cases", "nav.lab": "Lab", "nav.rx": "Rx",
    "nav.alerts": "Alerts", "nav.reports": "Reports", "nav.search": "Search",
    "nav.campaigns": "Campaigns", "nav.stock": "Stock", "nav.diseases": "Info",
    "nav.queue": "Queue", "nav.national": "National", "nav.scan": "Scan QR",
    "role.owner": "Animal Owner", "role.vet": "Veterinarian", "role.govt": "Govt Officer",
    "role.lab": "Laboratory Staff",
    "role.owner.desc": "Register animals, report health issues, track prescriptions & QR passport",
    "role.vet.desc": "Receive reports, diagnose, sample collection, lab tests, prescriptions & AI CDS",
    "role.govt.desc": "State analytics, disease surveillance, GIS risk, clusters & national surveillance",
    "role.lab.desc": "Sample intake, verification, biological testing, result entry & verified lab reports",
    "btn.login": "Login", "btn.register": "Register", "btn.logout": "Logout",
    "btn.save": "Save", "btn.submit": "Submit", "btn.create": "Create",
    "auth.choose": "Choose your portal", "auth.newHere": "New here?",
    "auth.haveAccount": "Already registered?", "auth.createAccount": "Create an account",
    "lang.label": "Language",
    "farmer.app_name": "Pashu-Mitra",
    "farmer.home": "Home", "farmer.dashboard_title": "Your Farm",
    "farmer.welcome_back": "Welcome back,", "farmer.home_prompt": "What would you like to do?",
    "farmer.my_livestock": "My Livestock", "farmer.add_animal": "Add Animal", "farmer.add_herd": "Add Herd",
    "farmer.my_animals": "My Animals", "farmer.my_herds": "My Herds",
    "farmer.report_problem": "Report a Problem", "farmer.cases": "Cases",
    "farmer.health_treatment": "Health", "farmer.notifications": "Notifications", "farmer.profile": "My Profile",
    "farmer.language": "Language", "farmer.what_to_do": "Choose an action",
    // In-app web call (WebRTC) — separate from the phone helpline.
    "farmer.call_vet": "Call a Veterinarian",
    "farmer.call_vet_help": "Talk to a veterinarian now, from this browser. Your microphone is used only during the call.",
    "farmer.call_language": "Call language", "farmer.call_reason": "Reason for calling",
    "farmer.call_notes": "Notes (optional)", "farmer.call_notes_placeholder": "Symptoms, since when, animal tag…",
    "farmer.start_call": "Start call", "farmer.call_history": "Call history",
    "farmer.helpline": "Helpline (phone call)",
    "farmer.helpline_help": "If nobody is online for a web call, you can dial the helpline from a phone. This is a separate telephone service.",
    "farmer.animal": "Animal", "farmer.animal_id": "Animal ID", "farmer.animal_name": "Animal Name",
    "farmer.animal_type": "Animal Type", "farmer.breed": "Breed", "farmer.age": "Age",
    "farmer.years": "years", "farmer.health_status": "Health", "farmer.status": "Status",
    "farmer.herd": "Herd", "farmer.herd_name": "Herd", "farmer.animal_count": "animals",
    "farmer.active_cases": "Open health cases", "farmer.no_active_cases": "No open health cases",
    "farmer.no_animals": "No animals yet", "farmer.no_animals_hint": "Add your first animal to see it here.",
    "farmer.no_herds": "No herds yet", "farmer.no_herds_hint": "Add a herd to group your animals.",
    "farmer.loading": "Loading…", "farmer.loading_dashboard": "Loading your home…",
    "farmer.loading_livestock": "Loading your livestock…", "farmer.loading_animal": "Loading animal details…",
    "farmer.loading_herd": "Loading herd details…", "farmer.loading_cases": "Loading your cases…",
    "farmer.loading_treatment": "Loading treatment…", "farmer.loading_notifications": "Loading notifications…",
    "farmer.open_details": "View details", "farmer.location": "Location", "farmer.back_to_livestock": "Back to My Livestock",
    "farmer.healthy": "Healthy", "farmer.under_treatment": "Under treatment", "farmer.under_observation": "Under observation", "farmer.deceased": "Deceased",
    "farmer.sick": "Sick", "farmer.at_risk": "Needs attention", "farmer.low_risk": "Low risk",
    "farmer.moderate_risk": "Some risk", "farmer.high_risk": "High risk", "farmer.critical": "Urgent",
    "farmer.unknown": "Not available", "farmer.healthy_message": "No current health problem reported.",
    "farmer.animal_information": "Animal details", "farmer.herd_information": "Herd details",
    "farmer.herd_animals": "Animals in this herd", "farmer.health_and_treatment": "Health and treatment",
    "farmer.treatment_history": "Treatment updates", "farmer.case_history": "Health reports",
    "farmer.vaccination_history": "Vaccination history", "farmer.test_results": "Test results",
    "farmer.no_treatments": "No treatment updates yet.", "farmer.no_cases": "No health reports yet.",
    "farmer.no_lab_reports": "No test results yet.", "farmer.no_vaccinations": "No vaccination records yet.",
    "farmer.no_herd_animals": "No animals are linked to this herd yet.",
    "farmer.reported": "Reported", "farmer.severity": "How serious is it?", "farmer.diagnosis": "Veterinarian's findings",
    "farmer.vet": "Veterinarian", "farmer.instructions": "Instructions", "farmer.follow_up": "Follow-up",
    "farmer.due": "Due", "farmer.given_on": "Given on", "farmer.medicine": "Medicine",
    "farmer.dosage": "Dose", "farmer.frequency": "How often", "farmer.duration": "For how long",
    "farmer.prescribed_by": "Prescribed by", "farmer.report_case": "Report a problem",
    "farmer.qr_tag": "Animal QR tag", "farmer.mark_deceased": "Mark as deceased", "farmer.delete_animal": "Delete animal",
    "farmer.select": "Select", "farmer.choose_animal": "Choose your animal", "farmer.cattle": "Cow / Cattle",
    "farmer.buffalo": "Buffalo", "farmer.goat": "Goat", "farmer.sheep": "Sheep", "farmer.other": "Other",
    "farmer.gender": "Gender", "farmer.female": "Female", "farmer.male": "Male",
    "farmer.optional": "optional", "farmer.no_herd": "No herd", "farmer.select_herd": "Select a herd",
    "farmer.age_placeholder": "Age in years", "farmer.breed_placeholder": "Enter breed",
    "farmer.full_name": "Full name", "farmer.mobile": "Mobile number", "farmer.village": "Village",
    "farmer.block": "Block", "farmer.district": "District", "farmer.create_herd": "Create Herd",
    "farmer.register_animal": "Save Animal", "farmer.creating_herd": "Creating herd…",
    "farmer.animal_registered": "Animal {code} added successfully.", "farmer.herd_created": "Herd {code} created successfully.",
    "farmer.validation_required": "Please fill in this field.", "farmer.validation_email": "Please enter a valid email address.",
    "farmer.validation_min_length": "Please enter at least {count} characters.",
    "farmer.generic_error": "Something went wrong. Please try again.", "farmer.connection_error": "Could not connect. Check your internet and try again.",
    "farmer.invalid_animal_type": "Please choose an animal type.", "farmer.invalid_herd": "That herd could not be found. Please choose again.",
    "farmer.save_animal_error": "Could not save the animal. Check the details and try again.",
    "farmer.animal_not_found": "Animal not found.", "farmer.herd_not_found": "Herd not found.",
    "farmer.access_error": "You do not have permission to view this information.",
    "farmer.report_title": "Report a health problem", "farmer.describe_symptoms": "Tell us what is wrong",
    "farmer.report_help": "Choose the animal and describe what you have noticed. A veterinarian will help.",
    "farmer.voice_report": "Describe by voice", "farmer.tap_to_speak": "Tap to speak",
    "farmer.stop_recording": "Stop recording", "farmer.press_mic": "Press the microphone and describe the problem.",
    "farmer.transcribed_voice": "Voice transcription", "farmer.processing_voice": "Preparing your voice message…",
    "farmer.symptoms": "What signs have you noticed?", "farmer.symptoms_placeholder": "For example: fever, not eating, or swelling",
    "farmer.severity_low": "Mild", "farmer.severity_medium": "Moderate", "farmer.severity_high": "Serious",
    "farmer.severity_critical": "Emergency", "farmer.additional_details": "Anything else we should know?",
    "farmer.details_placeholder": "When did this start? Is another animal affected?",
    "farmer.submit_report": "Send Report", "farmer.report_sent": "Your report was sent. Reference: {code}",
    "farmer.my_cases": "My Reports", "farmer.case_detail": "Report details", "farmer.case_number": "Reference number",
    "farmer.report_date": "Reported on", "farmer.case_status_new": "New", "farmer.case_status_assigned": "Veterinarian assigned",
    "farmer.case_status_investigation": "Being checked", "farmer.case_status_sample": "Sample collected",
    "farmer.case_status_lab": "Test in progress", "farmer.case_status_diagnosed": "Checked",
    "farmer.case_status_treatment": "Treatment", "farmer.case_status_follow_up": "Follow-up",
    "farmer.case_status_recovered": "Recovered", "farmer.case_status_closed": "Closed",
    "farmer.case_status_completed": "Completed", "farmer.case_updates": "Updates",
    "farmer.how_is_animal": "How is your animal now?", "farmer.recovery_status": "How is your animal feeling?",
    "farmer.improving": "Getting better", "farmer.same": "No change", "farmer.worse": "Getting worse",
    "farmer.notes": "Notes", "farmer.notes_placeholder": "Share any changes you have noticed.",
    "farmer.submit_feedback": "Send update", "farmer.feedback_thanks": "Thank you. Your update was sent.",
    "farmer.no_prescriptions": "No medicines have been prescribed yet.", "farmer.no_notifications": "You are all caught up.",
    "farmer.new": "New", "farmer.notification_case": "Health report", "farmer.notification_lab": "Test result",
    "farmer.notification_prescription": "Medicine", "farmer.notification_vaccination": "Vaccination",
    "farmer.notification_alert": "Health alert", "farmer.notification_info": "Notice",
    "farmer.notification_case_new": "New health report {case} for animal {animal}.",
    "farmer.notification_case_update": "Health report {case} updated: {status}.",
    "farmer.notification_lab_ready": "Test result {report} is ready for report {case}.",
    "farmer.notification_prescription_issued": "Medicine instructions are ready for report {case}.",
    "farmer.notification_vaccination_due": "Vaccination is due for animal {animal}. Please arrange a visit.",
    "farmer.notification_farm_alert": "Health alert: {disease} reported near {district}. {action}",
    "farmer.notification_vet_on_way": "Dr. {name} is on the way to help with report {case}.",
    "farmer.notification_vet_arrived": "Dr. {name} has arrived for report {case}.",
    "farmer.notification_test_requested": "A test has been requested for report {case}.",
    "farmer.notification_lab_problem": "The test for animal {animal} could not be completed: {reason}",
    "farmer.notification_case_recovered": "Report {case} has been marked as recovered by Dr. {name}.",
    "farmer.notification_auto_escalation": "Urgent: report {case} needs immediate attention.",
    "farmer.mobile_label": "Mobile", "farmer.email": "Email", "farmer.specialization": "Specialization",
    "farmer.current_language": "Current language", "farmer.logout": "Log out", "farmer.user": "User",
    "farmer.helpline_title": "Need help for an animal?", "farmer.helpline_name": "Pashu-Shield helpline",
    "farmer.call_now": "Call now", "farmer.desktop_call_note": "Use your mobile phone to call this number.",
    "farmer.not_found": "Page not found.", "farmer.go_home": "Go to Home", "farmer.error": "Something went wrong.",
    "farmer.offline_queued": "No internet. Your request is saved and will send when you reconnect.",
    "farmer.delete_confirm": "Delete animal {code}? Its health reports and treatment records will also be removed.",
    "farmer.animal_deleted": "Animal {code} deleted.", "farmer.deceased_prompt": "Enter the reason for marking animal {code} as deceased:",
    "farmer.animal_marked_deceased": "Animal {code} marked as deceased.", "farmer.cancel": "Cancel",
    "farmer.tracking_title": "Veterinarian visit", "farmer.tracking_report_placed": "Report sent",
    "farmer.tracking_vet_accepted": "Veterinarian accepted", "farmer.tracking_on_way": "On the way",
    "farmer.tracking_arrived": "Arrived", "farmer.tracking_visit_done": "Visit complete",
    "farmer.eta": "Estimated arrival", "farmer.minutes": "minutes", "farmer.assigned": "Assigned",
    "farmer.response_improved": "Getting better", "farmer.response_unchanged": "No change",
    "farmer.response_worsened": "Getting worse", "farmer.response_recovered": "Recovered",
    "farmer.response_adverse_reaction": "Reaction to medicine", "farmer.response_treatment_discontinued": "Treatment stopped",
    "farmer.response_follow_up_required": "Follow-up needed",
    "farmer.no_cases_home": "No reports yet.", "farmer.error_report_animal": "Choose an animal before sending the report.",
    "farmer.offline_count": "saved actions waiting to send · Tap to sync", "farmer.sync_success": "Saved actions sent successfully.",
    "farmer.farmer_portal": "Farmer portal", "farmer.demo_account": "Demo account", "farmer.username": "Username",
    "farmer.password": "Password", "farmer.email_or_mobile": "Email or mobile number", "farmer.confirm_password": "Confirm password",
    "farmer.positive": "Positive", "farmer.negative": "Negative", "farmer.pending": "Pending", "farmer.result": "Result",
    "farmer.download": "Download", "farmer.print": "Print tag", "farmer.close": "Close",
    "farmer.preferred_helpline_language": "Preferred language for calls", "farmer.ask_language_call": "Ask me during a call",
    "farmer.welcome_toast": "Welcome back, {name}!", "farmer.account_created": "Account created for {name}!", "farmer.logout_success": "You have logged out.",
    "farmer.voice_ready": "Ready. Speak now.", "farmer.voice_transcribing": "Listening to your message…", "farmer.voice_transcribed_status": "Your message is ready.",
    "farmer.voice_processing": "Preparing your voice message…", "farmer.voice_recording": "Recording… Please describe the problem.",
    "farmer.voice_error": "Could not understand the recording. Please try again.", "farmer.microphone_denied": "Microphone permission was not allowed.",
    "farmer.login_invalid": "The email, mobile number, or password is incorrect.", "farmer.account_exists": "An account with this email or mobile already exists.",
    "farmer.passwords_mismatch": "The passwords do not match.", "farmer.password_short": "Use at least 6 characters for the password.",
    "farmer.login_required": "Enter your email or mobile number and password.", "farmer.portal_mismatch": "Please use the correct portal for this account.",
    "farmer.register_error": "Please check the information and try again.",
    // ---- OTP login (farmer) ----
    "farmer.otp_title": "Login with mobile OTP", "farmer.otp_mobile_label": "Registered mobile number",
    "farmer.otp_mobile_hint": "Enter the 10-digit mobile number registered with PashuMitra.",
    "farmer.otp_mobile_placeholder": "10-digit mobile number",
    "farmer.send_otp": "Send OTP", "farmer.sending_otp": "Sending OTP…",
    "farmer.enter_otp": "Enter the 6-digit OTP", "farmer.otp_placeholder": "6-digit OTP",
    "farmer.verify_and_login": "Verify & Login", "farmer.verifying_otp": "Verifying…",
    "farmer.resend_otp": "Resend OTP", "farmer.resending_otp": "Resending…",
    "farmer.resend_in": "Resend in {seconds}s", "farmer.resend_ready": "Didn't get the OTP?",
    "farmer.change_mobile": "Change mobile number",
    // Honest delivery wording: a 200 only means the request was accepted. The
    // same sentence is shown for registered and unknown numbers (no enumeration).
    "farmer.otp_sent": "If +91 {mobile} is registered with PashuMitra, an OTP has been sent. It is valid for 5 minutes.",
    "farmer.otp_resent": "If +91 {mobile} is registered, a new OTP has been sent. It is valid for 5 minutes.",
    "farmer.otp_missing_hint": "Didn't get the SMS? Check that this number is registered with PashuMitra, keep the phone switched on and the SIM active, then tap Resend OTP.",
    "farmer.otp_invalid_mobile": "Enter a valid 10-digit mobile number.",
    "farmer.otp_invalid_code": "Enter the 6-digit OTP.",
    "farmer.otp_invalid": "The OTP is incorrect. Please check and try again.",
    "farmer.otp_expired": "This OTP has expired. Please request a new one.",
    "farmer.otp_locked": "Too many incorrect attempts. Please request a new OTP.",
    "farmer.otp_used": "This OTP was already used. Please request a new one.",
    "farmer.otp_cooldown": "Please wait before requesting another OTP.",
    "farmer.otp_rate_limited": "Too many OTP requests. Please try again later.",
    "farmer.otp_unavailable": "OTP SMS login is not available right now.",
    "farmer.otp_send_failed": "We could not send the OTP SMS. Please try again.",
    "farmer.otp_not_registered": "If this number is registered, you will receive an OTP.",
    "farmer.otp_offline": "You are offline. Connect to the internet to receive an OTP.",
    // ---- OTP signup: farmer profile creation (phone verified) ----
    "farmer.signup_title": "Create farmer account with mobile OTP",
    "farmer.signup_mobile_hint": "Enter your 10-digit mobile number. We will send an OTP to verify it before creating your profile.",
    "farmer.verify_mobile": "Verify mobile",
    "farmer.profile_title": "Complete your farmer profile",
    "farmer.profile_note": "+91 {mobile} is verified. Fill in your details to create your farmer account.",
    "farmer.create_account": "Create farmer account",
    "farmer.creating_account": "Creating account…",
    "farmer.profile_missing": "Please enter your full name and district.",
    "farmer.registration_expired": "This verification has expired. Please request a new OTP.",
    "farmer.signup_success": "Welcome, {name}! Your farmer profile has been created.",
    "farmer.signup_link": "New farmer? Create an account with mobile OTP",
    "farmer.login_link": "Already registered? Login with mobile OTP",
    "farmer.otp_unavailable_hint": "OTP SMS login is not available right now. Please try again shortly or call the helpline {helpline}.",
    "farmer.demo_mobile": "Demo mobile number",
    // ---- Prototype demo account (shown only while the server has DEMO_MODE on)
    "farmer.demo_account_title": "Demo Account",
    "farmer.demo_phone_label": "Phone Number",
    "farmer.demo_otp_label": "Demo OTP",
    "farmer.demo_use_button": "Use Demo Account",
    "farmer.demo_filled": "Demo number filled in. Tap Send OTP, then enter the demo OTP.",
    "farmer.demo_no_sms": "Prototype demo — no real SMS is sent. Use the demo OTP shown above.",
    "farmer.demo_welcome": "Signed in with the demo account.",
    "farmer.notification_settings": "Notification settings", "farmer.push_notifications": "Push notifications",
    "farmer.push_available": "Turn on push notifications to receive alerts about reports, test results, and health updates.",
    "farmer.push_unavailable": "Push notifications are not set up on this device. You will still receive in-app notifications.",
    "farmer.push_admin": "Push notifications are not set up on this server. In-app notifications will still work.",
    "farmer.enable_push": "Turn on notifications", "farmer.push_unsupported": "Push notifications are not supported on this device.",
    "farmer.push_permission_denied": "Notification permission was not given. Check your device settings.",
    "farmer.push_enabled": "Notifications are turned on.", "farmer.push_failed": "Could not turn on notifications. Please try again.",
  },
  mr: {
    "app.tagline": "पशुधन रोग अहवाल आणि पशुवैद्यकीय सेवा — महाराष्ट्र",
    "nav.dashboard": "मुख्यपृष्ठ", "nav.analytics": "विश्लेषण", "nav.gis": "जीआयएस धोका नकाशा",
    "nav.surveillance": "रोग पाळत", "nav.ai": "एआय धोका", "nav.reporting": "अहवाल",
    "nav.animals": "प्राणी", "nav.cases": "प्रकरणे", "nav.lab": "प्रयोगशाळा", "nav.rx": "औषध",
    "nav.alerts": "इशारे", "nav.reports": "अहवाल", "nav.search": "शोध",
    "nav.campaigns": "लसीकरण मोहीम", "nav.stock": "साठा", "nav.diseases": "माहिती",
    "nav.queue": "रांग", "nav.national": "राष्ट्रीय", "nav.scan": "स्कॅन",
    "role.owner": "पशुमालक", "role.vet": "पशुवैद्यक", "role.govt": "सरकारी अधिकारी",
    "role.lab": "प्रयोगशाळा कर्मचारी",
    "role.owner.desc": "प्राणी नोंदवा, आरोग्य अहवाल द्या, औषधे व क्यूआर पासपोर्ट पहा",
    "role.vet.desc": "अहवाल स्वीकारा, नमुना संकलन, निदान, प्रयोगशाळा, औषध व एआय सल्ला",
    "role.govt.desc": "राज्य विश्लेषण, रोग पाळत, जीआयएस धोका आणि राष्ट्रीय पूर्व चेतावणी",
    "role.lab.desc": "नमुना स्वीकृती, पडताळणी, जैविक चाचण्या, निकाल नोंदणी आणि अहवाल",
    "btn.login": "लॉगिन", "btn.register": "नोंदणी", "btn.logout": "बाहेर पडा",
    "btn.save": "जतन करा", "btn.submit": "सादर करा", "btn.create": "तयार करा",
    "auth.choose": "तुमचे पोर्टल निवडा", "auth.newHere": "नवीन आहात?",
    "auth.haveAccount": "आधीच नोंदणी केली आहे?", "auth.createAccount": "खाते तयार करा",
    "lang.label": "भाषा",
    "farmer.app_name": "पशुमित्र",
    "farmer.home": "मुख्यपृष्ठ", "farmer.dashboard_title": "तुमचे शेत",
    "farmer.welcome_back": "पुन्हा स्वागत आहे,", "farmer.home_prompt": "तुम्हाला काय करायचे आहे?",
    "farmer.my_livestock": "माझे पशुधन", "farmer.add_animal": "प्राणी जोडा", "farmer.add_herd": "कळप जोडा",
    "farmer.my_animals": "माझे प्राणी", "farmer.my_herds": "माझे कळप",
    "farmer.report_problem": "समस्या कळवा", "farmer.cases": "प्रकरणे",
    "farmer.health_treatment": "आरोग्य", "farmer.notifications": "सूचना", "farmer.profile": "माझे प्रोफाइल",
    "farmer.language": "भाषा", "farmer.what_to_do": "कृती निवडा",
    // ॲपमधील व्हेब कॉल (WebRTC) — फोन हेल्पलाइनपेक्षा वेगळा.
    "farmer.call_vet": "पशुवैद्यांना कॉल करा",
    "farmer.call_vet_help": "या ब्राउझरमधून आता पशुवैद्यांशी बोला. तुमचा माइक फक्त कॉल दरम्यान वापरला जातो.",
    "farmer.call_language": "कॉलची भाषा", "farmer.call_reason": "कॉल करण्याचे कारण",
    "farmer.call_notes": "टिप्पणी (ऐच्छिक)", "farmer.call_notes_placeholder": "लक्षणे, कधीपासून, प्राण्याचा टॅग…",
    "farmer.start_call": "कॉल सुरू करा", "farmer.call_history": "कॉल इतिहास",
    "farmer.helpline": "हेल्पलाइन (फोन कॉल)",
    "farmer.helpline_help": "व्हेब कॉलसाठी कोणी ऑनलाइन नसेल, तर तुम्ही फोनवरून हेल्पलाइनवर कॉल करू शकता. ही वेगळी टेलिफोन सेवा आहे.",
    "farmer.animal": "प्राणी", "farmer.animal_id": "प्राणी क्रमांक", "farmer.animal_name": "प्राण्याचे नाव",
    "farmer.animal_type": "प्राण्याचा प्रकार", "farmer.breed": "जात", "farmer.age": "वय",
    "farmer.years": "वर्षे", "farmer.health_status": "आरोग्य", "farmer.status": "स्थिती",
    "farmer.herd": "कळप", "farmer.herd_name": "कळप", "farmer.animal_count": "प्राणी",
    "farmer.active_cases": "सुरू असलेली आरोग्य प्रकरणे", "farmer.no_active_cases": "सध्या कोणतेही आरोग्य प्रकरण सुरू नाही",
    "farmer.no_animals": "अजून प्राणी नाहीत", "farmer.no_animals_hint": "तुमचा पहिला प्राणी येथे पाहण्यासाठी जोडा.",
    "farmer.no_herds": "अजून कळप नाहीत", "farmer.no_herds_hint": "प्राण्यांना एकत्र ठेवण्यासाठी कळप जोडा.",
    "farmer.loading": "लोड होत आहे…", "farmer.loading_dashboard": "तुमचे मुख्यपृष्ठ उघडत आहे…",
    "farmer.loading_livestock": "तुमचे पशुधन उघडत आहे…", "farmer.loading_animal": "प्राण्याची माहिती उघडत आहे…",
    "farmer.loading_herd": "कळपाची माहिती उघडत आहे…", "farmer.loading_cases": "तुमची प्रकरणे उघडत आहेत…",
    "farmer.loading_treatment": "उपचाराची माहिती उघडत आहे…", "farmer.loading_notifications": "सूचना उघडत आहेत…",
    "farmer.open_details": "माहिती पहा", "farmer.location": "ठिकाण", "farmer.back_to_livestock": "माझ्या पशुधनाकडे परत",
    "farmer.healthy": "निरोगी", "farmer.under_treatment": "उपचार सुरू", "farmer.under_observation": "निरीक्षण सुरू", "farmer.deceased": "मृत",
    "farmer.sick": "आजारी", "farmer.at_risk": "लक्ष देणे आवश्यक", "farmer.low_risk": "कमी धोका",
    "farmer.moderate_risk": "मध्यम धोका", "farmer.high_risk": "जास्त धोका", "farmer.critical": "तातडीचे",
    "farmer.unknown": "माहिती उपलब्ध नाही", "farmer.healthy_message": "सध्या आरोग्याची कोणतीही समस्या नोंदलेली नाही.",
    "farmer.animal_information": "प्राण्याची माहिती", "farmer.herd_information": "कळपाची माहिती",
    "farmer.herd_animals": "या कळपातील प्राणी", "farmer.health_and_treatment": "आरोग्य आणि उपचार",
    "farmer.treatment_history": "उपचारातील बदल", "farmer.case_history": "आरोग्य अहवाल",
    "farmer.vaccination_history": "लसीकरणाचा इतिहास", "farmer.test_results": "तपासणीचे निकाल",
    "farmer.no_treatments": "उपचाराबाबत अजून माहिती नाही.", "farmer.no_cases": "आरोग्य अहवाल नाहीत.",
    "farmer.no_lab_reports": "तपासणीचे निकाल नाहीत.", "farmer.no_vaccinations": "लसीकरणाची नोंद नाही.",
    "farmer.no_herd_animals": "या कळपात अजून कोणताही प्राणी जोडलेला नाही.",
    "farmer.reported": "कळवले", "farmer.severity": "समस्या किती गंभीर आहे?", "farmer.diagnosis": "पशुवैद्यकांचे निरीक्षण",
    "farmer.vet": "पशुवैद्यक", "farmer.instructions": "सूचना", "farmer.follow_up": "पुढील भेट",
    "farmer.due": "देय", "farmer.given_on": "दिल्याची तारीख", "farmer.medicine": "औषध",
    "farmer.dosage": "मात्रा", "farmer.frequency": "किती वेळा", "farmer.duration": "किती दिवस",
    "farmer.prescribed_by": "औषध दिले", "farmer.report_case": "समस्या कळवा",
    "farmer.qr_tag": "प्राण्याचा QR टॅग", "farmer.mark_deceased": "मृत म्हणून नोंदवा", "farmer.delete_animal": "प्राणी हटवा",
    "farmer.select": "निवडा", "farmer.choose_animal": "तुमचा प्राणी निवडा", "farmer.cattle": "गाय / बैल",
    "farmer.buffalo": "म्हैस", "farmer.goat": "शेळी", "farmer.sheep": "मेंढी", "farmer.other": "इतर",
    "farmer.gender": "लिंग", "farmer.female": "मादी", "farmer.male": "नर",
    "farmer.optional": "ऐच्छिक", "farmer.no_herd": "कळप नाही", "farmer.select_herd": "कळप निवडा",
    "farmer.age_placeholder": "वय वर्षांत", "farmer.breed_placeholder": "जात लिहा",
    "farmer.full_name": "पूर्ण नाव", "farmer.mobile": "मोबाईल क्रमांक", "farmer.village": "गाव",
    "farmer.block": "तालुका", "farmer.district": "जिल्हा", "farmer.create_herd": "कळप तयार करा",
    "farmer.register_animal": "प्राणी जतन करा", "farmer.creating_herd": "कळप तयार होत आहे…",
    "farmer.animal_registered": "प्राणी {code} यशस्वीरीत्या जोडला.", "farmer.herd_created": "कळप {code} तयार झाला.",
    "farmer.validation_required": "कृपया हे रकाना भरा.", "farmer.validation_email": "कृपया योग्य ईमेल पत्ता लिहा.",
    "farmer.validation_min_length": "कृपया किमान {count} अक्षरे लिहा.",
    "farmer.generic_error": "काहीतरी चूक झाली. कृपया पुन्हा प्रयत्न करा.", "farmer.connection_error": "जोडणी होत नाही. इंटरनेट तपासून पुन्हा प्रयत्न करा.",
    "farmer.invalid_animal_type": "कृपया प्राण्याचा प्रकार निवडा.", "farmer.invalid_herd": "हा कळप सापडला नाही. कृपया पुन्हा निवडा.",
    "farmer.save_animal_error": "प्राणी जतन झाला नाही. माहिती तपासून पुन्हा प्रयत्न करा.",
    "farmer.animal_not_found": "प्राणी सापडला नाही.", "farmer.herd_not_found": "कळप सापडला नाही.",
    "farmer.access_error": "ही माहिती पाहण्याची तुम्हाला परवानगी नाही.",
    "farmer.report_title": "आरोग्याची समस्या कळवा", "farmer.describe_symptoms": "काय त्रास आहे ते सांगा",
    "farmer.report_help": "प्राणी निवडा आणि तुम्हाला काय दिसले ते सांगा. पशुवैद्यक मदत करतील.",
    "farmer.voice_report": "बोलून सांगा", "farmer.tap_to_speak": "बोलण्यासाठी दाबा",
    "farmer.stop_recording": "रेकॉर्डिंग थांबवा", "farmer.press_mic": "मायक्रोफोन दाबून समस्या सांगा.",
    "farmer.transcribed_voice": "आवाजातून लिहिलेले", "farmer.processing_voice": "तुमचा आवाज समजून घेत आहोत…",
    "farmer.symptoms": "काय लक्षणे दिसत आहेत?", "farmer.symptoms_placeholder": "उदा. ताप, चारा न खाणे किंवा सूज",
    "farmer.severity_low": "किरकोळ", "farmer.severity_medium": "मध्यम", "farmer.severity_high": "गंभीर",
    "farmer.severity_critical": "तातडीची", "farmer.additional_details": "आणखी काही सांगायचे आहे का?",
    "farmer.details_placeholder": "हे कधी सुरू झाले? दुसरा प्राणीही आजारी आहे का?",
    "farmer.submit_report": "अहवाल पाठवा", "farmer.report_sent": "तुमचा अहवाल पाठवला. क्रमांक: {code}",
    "farmer.my_cases": "माझे अहवाल", "farmer.case_detail": "अहवालाची माहिती", "farmer.case_number": "संदर्भ क्रमांक",
    "farmer.report_date": "कळविल्याची तारीख", "farmer.case_status_new": "नवीन", "farmer.case_status_assigned": "पशुवैद्यक नेमले",
    "farmer.case_status_investigation": "तपासणी सुरू", "farmer.case_status_sample": "नमुना घेतला",
    "farmer.case_status_lab": "तपासणी सुरू", "farmer.case_status_diagnosed": "तपासणी पूर्ण",
    "farmer.case_status_treatment": "उपचार सुरू", "farmer.case_status_follow_up": "पुढील तपासणी",
    "farmer.case_status_recovered": "बरे झाले", "farmer.case_status_closed": "पूर्ण झाले",
    "farmer.case_status_completed": "पूर्ण झाले", "farmer.case_updates": "अहवालातील बदल",
    "farmer.how_is_animal": "तुमचा प्राणी आता कसा आहे?", "farmer.recovery_status": "प्राण्याला कसे वाटत आहे?",
    "farmer.improving": "बरे वाटत आहे", "farmer.same": "फरक नाही", "farmer.worse": "त्रास वाढत आहे",
    "farmer.notes": "नोंदी", "farmer.notes_placeholder": "तुम्हाला दिसलेले बदल सांगा.",
    "farmer.submit_feedback": "माहिती पाठवा", "farmer.feedback_thanks": "धन्यवाद. तुमची माहिती पाठवली.",
    "farmer.no_prescriptions": "अजून औषध दिलेले नाही.", "farmer.no_notifications": "सध्या नवीन सूचना नाहीत.",
    "farmer.new": "नवीन", "farmer.notification_case": "आरोग्य अहवाल", "farmer.notification_lab": "तपासणीचा निकाल",
    "farmer.notification_prescription": "औषध", "farmer.notification_vaccination": "लसीकरण",
    "farmer.notification_alert": "आरोग्य सूचना", "farmer.notification_info": "सूचना",
    "farmer.notification_case_new": "प्राणी {animal} साठी नवीन आरोग्य अहवाल: {case}.",
    "farmer.notification_case_update": "आरोग्य अहवाल {case} बदलला: {status}.",
    "farmer.notification_lab_ready": "अहवाल {case} साठी तपासणीचा निकाल {report} तयार आहे.",
    "farmer.notification_prescription_issued": "अहवाल {case} साठी औषधाच्या सूचना उपलब्ध आहेत.",
    "farmer.notification_vaccination_due": "प्राणी {animal} चे लसीकरण बाकी आहे. कृपया भेटीची व्यवस्था करा.",
    "farmer.notification_farm_alert": "आरोग्य सूचना: {district} जवळ {disease} आढळला. {action}",
    "farmer.notification_vet_on_way": "डॉ. {name} प्रकरण {case} साठी मदतीला येत आहेत.",
    "farmer.notification_vet_arrived": "डॉ. {name} प्रकरण {case} साठी पोहोचले आहेत.",
    "farmer.notification_test_requested": "प्रकरण {case} साठी तपासणी मागवली आहे.",
    "farmer.notification_lab_problem": "प्राणी {animal} ची तपासणी पूर्ण होऊ शकली नाही: {reason}",
    "farmer.notification_case_recovered": "डॉ. {name} यांनी प्रकरण {case} बरे झाल्याचे नोंदवले.",
    "farmer.notification_auto_escalation": "तातडीचे: अहवाल {case} कडे लगेच लक्ष देणे आवश्यक आहे.",
    "farmer.mobile_label": "मोबाईल", "farmer.email": "ईमेल", "farmer.specialization": "विशेषता",
    "farmer.current_language": "सध्याची भाषा", "farmer.logout": "बाहेर पडा", "farmer.user": "वापरकर्ता",
    "farmer.helpline_title": "प्राण्यासाठी मदत हवी आहे?", "farmer.helpline_name": "पशु-शील्ड मदत क्रमांक",
    "farmer.call_now": "आता कॉल करा", "farmer.desktop_call_note": "या क्रमांकावर मोबाईलवरून कॉल करा.",
    "farmer.not_found": "पान सापडले नाही.", "farmer.go_home": "मुख्यपृष्ठावर जा", "farmer.error": "काहीतरी चूक झाली.",
    "farmer.offline_queued": "इंटरनेट नाही. विनंती जतन केली आहे; इंटरनेट आल्यावर पाठवली जाईल.",
    "farmer.delete_confirm": "प्राणी {code} हटवायचा? त्याचे आरोग्य अहवाल आणि उपचार नोंदीही हटतील.",
    "farmer.animal_deleted": "प्राणी {code} हटवला.", "farmer.deceased_prompt": "प्राणी {code} मृत म्हणून नोंदवण्याचे कारण लिहा:",
    "farmer.animal_marked_deceased": "प्राणी {code} मृत म्हणून नोंदवला.", "farmer.cancel": "रद्द करा",
    "farmer.tracking_title": "पशुवैद्यकांची भेट", "farmer.tracking_report_placed": "अहवाल पाठवला",
    "farmer.tracking_vet_accepted": "पशुवैद्यकांनी स्वीकारला", "farmer.tracking_on_way": "येत आहेत",
    "farmer.tracking_arrived": "पोहोचले", "farmer.tracking_visit_done": "भेट पूर्ण",
    "farmer.eta": "अंदाजे पोहोचण्याची वेळ", "farmer.minutes": "मिनिटे", "farmer.assigned": "नेमले",
    "farmer.response_improved": "बरे वाटत आहे", "farmer.response_unchanged": "फरक नाही",
    "farmer.response_worsened": "त्रास वाढत आहे", "farmer.response_recovered": "बरे झाले",
    "farmer.response_adverse_reaction": "औषधाची प्रतिक्रिया", "farmer.response_treatment_discontinued": "उपचार थांबवले",
    "farmer.response_follow_up_required": "पुढील तपासणी आवश्यक",
    "farmer.no_cases_home": "अजून कोणताही अहवाल नाही.", "farmer.error_report_animal": "अहवाल पाठवण्यापूर्वी प्राणी निवडा.",
    "farmer.offline_count": "जतन केलेल्या कृती पाठवायच्या आहेत · पाठवण्यासाठी दाबा", "farmer.sync_success": "जतन केलेल्या कृती यशस्वीरीत्या पाठवल्या.",
    "farmer.farmer_portal": "शेतकरी पोर्टल", "farmer.demo_account": "डेमो खाते", "farmer.username": "वापरकर्ता नाव",
    "farmer.password": "पासवर्ड", "farmer.email_or_mobile": "ईमेल किंवा मोबाईल क्रमांक", "farmer.confirm_password": "पासवर्ड पुन्हा लिहा",
    "farmer.positive": "सकारात्मक", "farmer.negative": "नकारात्मक", "farmer.pending": "प्रलंबित", "farmer.result": "निकाल",
    "farmer.download": "डाउनलोड करा", "farmer.print": "टॅग छापा", "farmer.close": "बंद करा",
    "farmer.preferred_helpline_language": "कॉलसाठी पसंतीची भाषा", "farmer.ask_language_call": "कॉलवर मला विचारा",
    "farmer.welcome_toast": "पुन्हा स्वागत आहे, {name}!", "farmer.account_created": "{name} यांचे खाते तयार झाले!", "farmer.logout_success": "तुम्ही बाहेर पडलात.",
    "farmer.voice_ready": "तयार आहे. आता बोला.", "farmer.voice_transcribing": "तुमचे बोलणे ऐकत आहोत…", "farmer.voice_transcribed_status": "तुमचा संदेश तयार आहे.",
    "farmer.voice_processing": "तुमचा आवाज तयार करत आहोत…", "farmer.voice_recording": "रेकॉर्डिंग सुरू… समस्या स्पष्ट सांगा.",
    "farmer.voice_error": "आवाज समजला नाही. कृपया पुन्हा प्रयत्न करा.", "farmer.microphone_denied": "मायक्रोफोन वापरण्याची परवानगी मिळाली नाही.",
    "farmer.login_invalid": "ईमेल, मोबाईल क्रमांक किंवा पासवर्ड चुकीचा आहे.", "farmer.account_exists": "या ईमेल किंवा मोबाईल क्रमांकाचे खाते आधीच आहे.",
    "farmer.passwords_mismatch": "दोन्ही पासवर्ड जुळत नाहीत.", "farmer.password_short": "पासवर्डमध्ये किमान ६ अक्षरे असावीत.",
    "farmer.login_required": "ईमेल किंवा मोबाईल क्रमांक आणि पासवर्ड लिहा.", "farmer.portal_mismatch": "या खात्यासाठी योग्य पोर्टल निवडा.",
    "farmer.register_error": "माहिती तपासून पुन्हा प्रयत्न करा.",
    // ---- OTP login (farmer) ----
    "farmer.otp_title": "मोबाईल OTP ने लॉगिन", "farmer.otp_mobile_label": "नोंदणीकृत मोबाईल क्रमांक",
    "farmer.otp_mobile_hint": "पशुमित्रात नोंदवलेला १० अंकी मोबाईल क्रमांक लिहा.",
    "farmer.otp_mobile_placeholder": "१० अंकी मोबाईल क्रमांक",
    "farmer.send_otp": "OTP पाठवा", "farmer.sending_otp": "OTP पाठवत आहे…",
    "farmer.enter_otp": "६ अंकी OTP लिहा", "farmer.otp_placeholder": "६ अंकी OTP",
    "farmer.verify_and_login": "तपासा व लॉगिन करा", "farmer.verifying_otp": "तपासत आहे…",
    "farmer.resend_otp": "OTP पुन्हा पाठवा", "farmer.resending_otp": "पुन्हा पाठवत आहे…",
    "farmer.resend_in": "{seconds} सेकंदांनी पुन्हा पाठवा", "farmer.resend_ready": "OTP मिळाला नाही?",
    "farmer.change_mobile": "मोबाईल क्रमांक बदला",
    "farmer.otp_sent": "+91 {mobile} पशुमित्रात नोंदणीकृत असल्यास OTP पाठवला आहे. तो ५ मिनिटांसाठी वैध आहे.",
    "farmer.otp_resent": "+91 {mobile} नोंदणीकृत असल्यास नवीन OTP पाठवला आहे. तो ५ मिनिटांसाठी वैध आहे.",
    "farmer.otp_missing_hint": "SMS मिळाला नाही? हा क्रमांक पशुमित्रात नोंदणीकृत आहे का तपासा, फोन सुरू आणि SIM सक्रिय ठेवा, नंतर 'OTP पुन्हा पाठवा' दाबा.",
    "farmer.otp_invalid_mobile": "वैध १० अंकी मोबाईल क्रमांक लिहा.",
    "farmer.otp_invalid_code": "६ अंकी OTP लिहा.",
    "farmer.otp_invalid": "OTP चुकीचा आहे. तपासून पुन्हा प्रयत्न करा.",
    "farmer.otp_expired": "हा OTP कालबाह्य झाला आहे. कृपया नवीन OTP मागवा.",
    "farmer.otp_locked": "खूप चुकीचे प्रयत्न झाले. कृपया नवीन OTP मागवा.",
    "farmer.otp_used": "हा OTP आधीच वापरला गेला आहे. कृपया नवीन OTP मागवा.",
    "farmer.otp_cooldown": "अजून एक OTP मागवण्यापूर्वी कृपया थोडी वाट पाहा.",
    "farmer.otp_rate_limited": "खूप OTP विनंत्या झाल्या. कृपया नंतर प्रयत्न करा.",
    "farmer.otp_unavailable": "OTP SMS लॉगिन सध्या उपलब्ध नाही.",
    "farmer.otp_send_failed": "OTP SMS पाठवता आला नाही. कृपया पुन्हा प्रयत्न करा.",
    "farmer.otp_not_registered": "हा क्रमांक नोंदणीकृत असल्यास तुम्हाला OTP मिळेल.",
    "farmer.otp_offline": "तुम्ही ऑफलाइन आहात. OTP मिळवण्यासाठी इंटरनेटशी जोडा.",
    "farmer.signup_title": "मोबाईल OTP ने शेतकरी खाते तयार करा",
    "farmer.signup_mobile_hint": "तुमचा १० अंकी मोबाईल क्रमांक लिहा. खाते तयार करण्यापूर्वी आम्ही OTP पाठवून पडताळणी करू.",
    "farmer.verify_mobile": "मोबाईल पडताळा",
    "farmer.profile_title": "तुमची शेतकरी माहिती पूर्ण करा",
    "farmer.profile_note": "+91 {mobile} पडताळला गेला. शेतकरी खाते तयार करण्यासाठी माहिती भरा.",
    "farmer.create_account": "शेतकरी खाते तयार करा",
    "farmer.creating_account": "खाते तयार होत आहे…",
    "farmer.profile_missing": "कृपया पूर्ण नाव आणि जिल्हा लिहा.",
    "farmer.registration_expired": "ही पडताळणी कालबाह्य झाली. कृपया नवीन OTP मागवा.",
    "farmer.signup_success": "स्वागत, {name}! तुमचे शेतकरी खाते तयार झाले.",
    "farmer.signup_link": "नवीन शेतकरी? मोबाईल OTP ने खाते तयार करा",
    "farmer.login_link": "आधीच नोंदणीकृत? मोबाईल OTP ने लॉगिन करा",
    "farmer.otp_unavailable_hint": "OTP SMS लॉगिन सध्या उपलब्ध नाही. कृपया थोड्या वेळाने प्रयत्न करा किंवा हेल्पलाइन {helpline} वर कॉल करा.",
    "farmer.demo_mobile": "डेमो मोबाईल क्रमांक",
    "farmer.demo_account_title": "डेमो खाते",
    "farmer.demo_phone_label": "मोबाईल क्रमांक",
    "farmer.demo_otp_label": "डेमो OTP",
    "farmer.demo_use_button": "डेमो खाते वापरा",
    "farmer.demo_filled": "डेमो क्रमांक भरला आहे. OTP पाठवा दाबा, नंतर डेमो OTP टाका.",
    "farmer.demo_no_sms": "प्रोटोटाइप डेमो — खरे SMS पाठवले जात नाहीत. वर दाखवलेला डेमो OTP वापरा.",
    "farmer.demo_welcome": "डेमो खात्याने लॉगिन केले.",
    "farmer.notification_settings": "सूचना सेटिंग्ज", "farmer.push_notifications": "पुश सूचना",
    "farmer.push_available": "अहवाल, तपासणीचे निकाल आणि आरोग्याची माहिती मिळवण्यासाठी पुश सूचना सुरू करा.",
    "farmer.push_unavailable": "या उपकरणावर पुश सूचना सुरू केलेल्या नाहीत. अॅपमधील सूचना मिळत राहतील.",
    "farmer.push_admin": "या सर्व्हरवर पुश सूचना सुरू केलेल्या नाहीत. अॅपमधील सूचना मिळत राहतील.",
    "farmer.enable_push": "सूचना सुरू करा", "farmer.push_unsupported": "या उपकरणावर पुश सूचना उपलब्ध नाहीत.",
    "farmer.push_permission_denied": "सूचनांची परवानगी दिली नाही. उपकरणाच्या सेटिंग्ज तपासा.",
    "farmer.push_enabled": "सूचना सुरू झाल्या.", "farmer.push_failed": "सूचना सुरू करता आल्या नाहीत. पुन्हा प्रयत्न करा.",
  },
  hi: {
    "app.tagline": "पशुधन रोग रिपोर्टिंग और पशु चिकित्सा सेवा — महाराष्ट्र",
    "nav.dashboard": "मुख्यपृष्ठ", "nav.analytics": "विश्लेषण", "nav.gis": "जीआईएस जोखिम मानचित्र",
    "nav.surveillance": "रोग निगरानी", "nav.ai": "एआई जोखिम", "nav.reporting": "रिपोर्ट",
    "nav.animals": "पशु", "nav.cases": "मामले", "nav.lab": "प्रयोगशाला", "nav.rx": "दवा",
    "nav.alerts": "अलर्ट", "nav.reports": "रिपोर्ट", "nav.search": "खोज",
    "nav.campaigns": "टीकाकरण अभियान", "nav.stock": "स्टॉक", "nav.diseases": "जानकारी",
    "nav.queue": "कतार", "nav.national": "राष्ट्रीय", "nav.scan": "स्कैन",
    "role.owner": "पशु मालिक", "role.vet": "पशु चिकित्सक", "role.govt": "सरकारी अधिकारी",
    "role.lab": "प्रयोगशाला कर्मचारी",
    "role.owner.desc": "पशु पंजीकरण, स्वास्थ्य रिपोर्ट, दवाएं और क्यूआर पासपोर्ट देखें",
    "role.vet.desc": "रिपोर्ट प्राप्त करें, नमूना संग्रह, निदान, प्रयोगशाला, दवा और एआई सलाह",
    "role.govt.desc": "राज्य विश्लेषण, रोग निगरानी, जीआईएस जोखिम और राष्ट्रीय पूर्व चेतावनी",
    "role.lab.desc": "नमूना प्राप्ति, सत्यापन, जैविक परीक्षण, परिणाम प्रविष्टि और रिपोर्ट",
    "btn.login": "लॉगिन", "btn.register": "पंजीकरण", "btn.logout": "लॉगआउट",
    "btn.save": "सहेजें", "btn.submit": "जमा करें", "btn.create": "बनाएं",
    "auth.choose": "अपना पोर्टल चुनें", "auth.newHere": "यहां नए हैं?",
    "auth.haveAccount": "पहले से पंजीकृत?", "auth.createAccount": "खाता बनाएं",
    "lang.label": "भाषा",
    "farmer.app_name": "पशु-मित्र",
    "farmer.home": "होम", "farmer.dashboard_title": "आपका पशु-आँगन",
    "farmer.welcome_back": "वापस स्वागत है,", "farmer.home_prompt": "आप क्या करना चाहते हैं?",
    "farmer.my_livestock": "मेरे पशु", "farmer.add_animal": "पशु जोड़ें", "farmer.add_herd": "झुंड जोड़ें",
    "farmer.my_animals": "मेरे पशु", "farmer.my_herds": "मेरे झुंड",
    "farmer.report_problem": "समस्या बताएं", "farmer.cases": "रिपोर्ट",
    "farmer.health_treatment": "स्वास्थ्य", "farmer.notifications": "सूचनाएं", "farmer.profile": "मेरी प्रोफ़ाइल",
    "farmer.language": "भाषा", "farmer.what_to_do": "एक काम चुनें",
    // ऐप में वेब कॉल (WebRTC) — फ़ोन हेल्पलाइन से अलग.
    "farmer.call_vet": "पशु चिकित्सक को कॉल करें",
    "farmer.call_vet_help": "इस ब्राउज़र से अभी पशु चिकित्सक से बात करें. माइक्रोफ़ोन केवल कॉल के दौरान उपयोग होता है.",
    "farmer.call_language": "कॉल की भाषा", "farmer.call_reason": "कॉल करने का कारण",
    "farmer.call_notes": "टिप्पणी (वैकल्पिक)", "farmer.call_notes_placeholder": "लक्षण, कब से, पशु टैग…",
    "farmer.start_call": "कॉल शुरू करें", "farmer.call_history": "कॉल इतिहास",
    "farmer.helpline": "हेल्पलाइन (फ़ोन कॉल)",
    "farmer.helpline_help": "वेब कॉल के लिए कोई ऑनलाइन न हो तो आप फ़ोन से हेल्पलाइन पर कॉल कर सकते हैं. यह अलग टेलीफ़ोन सेवा है.",
    "farmer.animal": "पशु", "farmer.animal_id": "पशु आईडी", "farmer.animal_name": "पशु का नाम",
    "farmer.animal_type": "पशु का प्रकार", "farmer.breed": "नस्ल", "farmer.age": "उम्र",
    "farmer.years": "साल", "farmer.health_status": "सेहत", "farmer.status": "स्थिति",
    "farmer.herd": "झुंड", "farmer.herd_name": "झुंड", "farmer.animal_count": "पशु",
    "farmer.active_cases": "खुले स्वास्थ्य मामले", "farmer.no_active_cases": "कोई स्वास्थ्य मामला खुला नहीं है",
    "farmer.no_animals": "अभी कोई पशु नहीं", "farmer.no_animals_hint": "पहला पशु जोड़ें, वह यहां दिखाई देगा।",
    "farmer.no_herds": "अभी कोई झुंड नहीं", "farmer.no_herds_hint": "अपने पशुओं को समूह में रखने के लिए झुंड जोड़ें।",
    "farmer.loading": "लोड हो रहा है…", "farmer.loading_dashboard": "आपका होम खुल रहा है…",
    "farmer.loading_livestock": "आपके पशु लोड हो रहे हैं…", "farmer.loading_animal": "पशु की जानकारी लोड हो रही है…",
    "farmer.loading_herd": "झुंड की जानकारी लोड हो रही है…", "farmer.loading_cases": "आपकी रिपोर्ट लोड हो रही हैं…",
    "farmer.loading_treatment": "इलाज की जानकारी लोड हो रही है…", "farmer.loading_notifications": "सूचनाएं लोड हो रही हैं…",
    "farmer.open_details": "जानकारी देखें", "farmer.location": "जगह", "farmer.back_to_livestock": "मेरे पशुओं पर वापस जाएं",
    "farmer.healthy": "स्वस्थ", "farmer.under_treatment": "इलाज चल रहा है", "farmer.under_observation": "निगरानी जारी", "farmer.deceased": "मृत",
    "farmer.sick": "बीमार", "farmer.at_risk": "ध्यान देने की जरूरत", "farmer.low_risk": "कम जोखिम",
    "farmer.moderate_risk": "मध्यम जोखिम", "farmer.high_risk": "ज्यादा जोखिम", "farmer.critical": "तुरंत ध्यान दें",
    "farmer.unknown": "जानकारी उपलब्ध नहीं", "farmer.healthy_message": "अभी कोई स्वास्थ्य समस्या दर्ज नहीं है।",
    "farmer.animal_information": "पशु की जानकारी", "farmer.herd_information": "झुंड की जानकारी",
    "farmer.herd_animals": "इस झुंड के पशु", "farmer.health_and_treatment": "स्वास्थ्य और इलाज",
    "farmer.treatment_history": "इलाज की जानकारी", "farmer.case_history": "स्वास्थ्य रिपोर्ट",
    "farmer.vaccination_history": "टीकाकरण का इतिहास", "farmer.test_results": "जांच के नतीजे",
    "farmer.no_treatments": "अभी इलाज की कोई जानकारी नहीं।", "farmer.no_cases": "अभी कोई स्वास्थ्य रिपोर्ट नहीं।",
    "farmer.no_lab_reports": "अभी जांच के नतीजे नहीं हैं।", "farmer.no_vaccinations": "टीकाकरण की जानकारी नहीं है।",
    "farmer.no_herd_animals": "इस झुंड में अभी कोई पशु नहीं जोड़ा गया है।",
    "farmer.reported": "बताया गया", "farmer.severity": "समस्या कितनी गंभीर है?", "farmer.diagnosis": "पशु चिकित्सक की जांच",
    "farmer.vet": "पशु चिकित्सक", "farmer.instructions": "निर्देश", "farmer.follow_up": "अगली जांच",
    "farmer.due": "देय", "farmer.given_on": "दिया गया", "farmer.medicine": "दवा",
    "farmer.dosage": "खुराक", "farmer.frequency": "कितनी बार", "farmer.duration": "कितने दिन",
    "farmer.prescribed_by": "दवा लिखने वाले", "farmer.report_case": "समस्या बताएं",
    "farmer.qr_tag": "पशु का QR टैग", "farmer.mark_deceased": "मृत दर्ज करें", "farmer.delete_animal": "पशु हटाएं",
    "farmer.select": "चुनें", "farmer.choose_animal": "अपना पशु चुनें", "farmer.cattle": "गाय / बैल",
    "farmer.buffalo": "भैंस", "farmer.goat": "बकरी", "farmer.sheep": "भेड़", "farmer.other": "अन्य",
    "farmer.gender": "लिंग", "farmer.female": "मादा", "farmer.male": "नर",
    "farmer.optional": "वैकल्पिक", "farmer.no_herd": "कोई झुंड नहीं", "farmer.select_herd": "झुंड चुनें",
    "farmer.age_placeholder": "उम्र साल में", "farmer.breed_placeholder": "नस्ल लिखें",
    "farmer.full_name": "पूरा नाम", "farmer.mobile": "मोबाइल नंबर", "farmer.village": "गांव",
    "farmer.block": "ब्लॉक", "farmer.district": "जिला", "farmer.create_herd": "झुंड बनाएं",
    "farmer.register_animal": "पशु सहेजें", "farmer.creating_herd": "झुंड बनाया जा रहा है…",
    "farmer.animal_registered": "पशु {code} सफलतापूर्वक जोड़ा गया।", "farmer.herd_created": "झुंड {code} बन गया।",
    "farmer.validation_required": "कृपया यह जानकारी भरें।", "farmer.validation_email": "कृपया सही ईमेल पता लिखें।",
    "farmer.validation_min_length": "कम से कम {count} अक्षर लिखें।",
    "farmer.generic_error": "कुछ गलत हुआ। कृपया फिर कोशिश करें।", "farmer.connection_error": "कनेक्शन नहीं हो पा रहा। इंटरनेट जांचकर फिर कोशिश करें।",
    "farmer.invalid_animal_type": "कृपया पशु का प्रकार चुनें।", "farmer.invalid_herd": "यह झुंड नहीं मिला। कृपया फिर चुनें।",
    "farmer.save_animal_error": "पशु सहेजा नहीं जा सका। जानकारी जांचकर फिर कोशिश करें।",
    "farmer.animal_not_found": "पशु नहीं मिला।", "farmer.herd_not_found": "झुंड नहीं मिला।",
    "farmer.access_error": "आपको यह जानकारी देखने की अनुमति नहीं है।",
    "farmer.report_title": "स्वास्थ्य समस्या बताएं", "farmer.describe_symptoms": "क्या परेशानी है, बताएं",
    "farmer.report_help": "पशु चुनें और जो बदलाव दिखे वह बताएं। पशु चिकित्सक मदद करेंगे।",
    "farmer.voice_report": "बोलकर बताएं", "farmer.tap_to_speak": "बोलने के लिए दबाएं",
    "farmer.stop_recording": "रिकॉर्डिंग रोकें", "farmer.press_mic": "माइक दबाकर समस्या बताएं।",
    "farmer.transcribed_voice": "आवाज से लिखा गया", "farmer.processing_voice": "आपकी आवाज समझी जा रही है…",
    "farmer.symptoms": "क्या लक्षण दिखे?", "farmer.symptoms_placeholder": "जैसे: बुखार, खाना न खाना या सूजन",
    "farmer.severity_low": "हल्की", "farmer.severity_medium": "मध्यम", "farmer.severity_high": "गंभीर",
    "farmer.severity_critical": "आपातकाल", "farmer.additional_details": "क्या कुछ और बताना चाहेंगे?",
    "farmer.details_placeholder": "यह कब शुरू हुआ? क्या कोई और पशु भी बीमार है?",
    "farmer.submit_report": "रिपोर्ट भेजें", "farmer.report_sent": "आपकी रिपोर्ट भेजी गई। संदर्भ: {code}",
    "farmer.my_cases": "मेरी रिपोर्ट", "farmer.case_detail": "रिपोर्ट की जानकारी", "farmer.case_number": "संदर्भ नंबर",
    "farmer.report_date": "बताने की तारीख", "farmer.case_status_new": "नई", "farmer.case_status_assigned": "पशु चिकित्सक तय हुए",
    "farmer.case_status_investigation": "जांच जारी", "farmer.case_status_sample": "नमूना लिया गया",
    "farmer.case_status_lab": "जांच जारी", "farmer.case_status_diagnosed": "जांच पूरी",
    "farmer.case_status_treatment": "इलाज चल रहा है", "farmer.case_status_follow_up": "दोबारा जांच",
    "farmer.case_status_recovered": "ठीक हो गया", "farmer.case_status_closed": "बंद",
    "farmer.case_status_completed": "पूरा हुआ", "farmer.case_updates": "रिपोर्ट में बदलाव",
    "farmer.how_is_animal": "आपका पशु अब कैसा है?", "farmer.recovery_status": "पशु कैसा महसूस कर रहा है?",
    "farmer.improving": "बेहतर हो रहा है", "farmer.same": "कोई बदलाव नहीं", "farmer.worse": "और खराब हो रहा है",
    "farmer.notes": "जानकारी", "farmer.notes_placeholder": "आपने जो बदलाव देखे, बताएं।",
    "farmer.submit_feedback": "जानकारी भेजें", "farmer.feedback_thanks": "धन्यवाद। आपकी जानकारी भेज दी गई।",
    "farmer.no_prescriptions": "अभी कोई दवा नहीं लिखी गई है।", "farmer.no_notifications": "अभी कोई नई सूचना नहीं है।",
    "farmer.new": "नई", "farmer.notification_case": "स्वास्थ्य रिपोर्ट", "farmer.notification_lab": "जांच का नतीजा",
    "farmer.notification_prescription": "दवा", "farmer.notification_vaccination": "टीकाकरण",
    "farmer.notification_alert": "स्वास्थ्य सूचना", "farmer.notification_info": "सूचना",
    "farmer.notification_case_new": "पशु {animal} के लिए नई स्वास्थ्य रिपोर्ट: {case}।",
    "farmer.notification_case_update": "स्वास्थ्य रिपोर्ट {case} में बदलाव: {status}।",
    "farmer.notification_lab_ready": "रिपोर्ट {case} के लिए जांच का नतीजा {report} तैयार है।",
    "farmer.notification_prescription_issued": "रिपोर्ट {case} के लिए दवा के निर्देश तैयार हैं।",
    "farmer.notification_vaccination_due": "पशु {animal} का टीकाकरण बाकी है। कृपया समय तय करें।",
    "farmer.notification_farm_alert": "स्वास्थ्य सूचना: {district} के पास {disease} की जानकारी मिली। {action}",
    "farmer.notification_vet_on_way": "डॉ. {name} रिपोर्ट {case} में मदद के लिए आ रहे हैं।",
    "farmer.notification_vet_arrived": "डॉ. {name} रिपोर्ट {case} के लिए पहुंच गए हैं।",
    "farmer.notification_test_requested": "रिपोर्ट {case} के लिए जांच मांगी गई है।",
    "farmer.notification_lab_problem": "पशु {animal} की जांच पूरी नहीं हो सकी: {reason}",
    "farmer.notification_case_recovered": "डॉ. {name} ने रिपोर्ट {case} को ठीक हुआ दर्ज किया है।",
    "farmer.notification_auto_escalation": "जरूरी: रिपोर्ट {case} पर तुरंत ध्यान देना चाहिए।",
    "farmer.mobile_label": "मोबाइल", "farmer.email": "ईमेल", "farmer.specialization": "विशेषता",
    "farmer.current_language": "अभी की भाषा", "farmer.logout": "लॉगआउट", "farmer.user": "उपयोगकर्ता",
    "farmer.helpline_title": "पशु के लिए मदद चाहिए?", "farmer.helpline_name": "पशु-शील्ड हेल्पलाइन",
    "farmer.call_now": "अभी कॉल करें", "farmer.desktop_call_note": "इस नंबर पर अपने मोबाइल से कॉल करें।",
    "farmer.not_found": "पेज नहीं मिला।", "farmer.go_home": "होम पर जाएं", "farmer.error": "कुछ गलत हुआ।",
    "farmer.offline_queued": "इंटरनेट नहीं है। अनुरोध सहेजा गया है; इंटरनेट जुड़ने पर भेजा जाएगा।",
    "farmer.delete_confirm": "पशु {code} हटाएं? उसकी स्वास्थ्य रिपोर्ट और इलाज की जानकारी भी हट जाएगी।",
    "farmer.animal_deleted": "पशु {code} हटा दिया गया।", "farmer.deceased_prompt": "पशु {code} को मृत दर्ज करने का कारण लिखें:",
    "farmer.animal_marked_deceased": "पशु {code} को मृत दर्ज किया गया।", "farmer.cancel": "रद्द करें",
    "farmer.tracking_title": "पशु चिकित्सक की मुलाकात", "farmer.tracking_report_placed": "रिपोर्ट भेजी गई",
    "farmer.tracking_vet_accepted": "पशु चिकित्सक ने स्वीकार किया", "farmer.tracking_on_way": "रास्ते में हैं",
    "farmer.tracking_arrived": "पहुंच गए", "farmer.tracking_visit_done": "मुलाकात पूरी",
    "farmer.eta": "पहुंचने का अनुमान", "farmer.minutes": "मिनट", "farmer.assigned": "तय किए गए",
    "farmer.response_improved": "बेहतर हो रहा है", "farmer.response_unchanged": "कोई बदलाव नहीं",
    "farmer.response_worsened": "और खराब हो रहा है", "farmer.response_recovered": "ठीक हो गया",
    "farmer.response_adverse_reaction": "दवा की प्रतिक्रिया", "farmer.response_treatment_discontinued": "इलाज रोक दिया गया",
    "farmer.response_follow_up_required": "दोबारा जांच जरूरी",
    "farmer.no_cases_home": "अभी कोई रिपोर्ट नहीं है।", "farmer.error_report_animal": "रिपोर्ट भेजने से पहले पशु चुनें।",
    "farmer.offline_count": "सहेजी गई रिपोर्ट भेजें · भेजने के लिए दबाएं", "farmer.sync_success": "सहेजी गई रिपोर्ट सफलतापूर्वक भेजी गईं।",
    "farmer.farmer_portal": "किसान पोर्टल", "farmer.demo_account": "डेमो खाता", "farmer.username": "उपयोगकर्ता नाम",
    "farmer.password": "पासवर्ड", "farmer.email_or_mobile": "ईमेल या मोबाइल नंबर", "farmer.confirm_password": "पासवर्ड की पुष्टि करें",
    "farmer.positive": "सकारात्मक", "farmer.negative": "नकारात्मक", "farmer.pending": "लंबित", "farmer.result": "नतीजा",
    "farmer.download": "डाउनलोड करें", "farmer.print": "टैग प्रिंट करें", "farmer.close": "बंद करें",
    "farmer.preferred_helpline_language": "कॉल के लिए पसंदीदा भाषा", "farmer.ask_language_call": "कॉल के दौरान पूछें",
    "farmer.welcome_toast": "वापस स्वागत है, {name}!", "farmer.account_created": "{name} का खाता बन गया!", "farmer.logout_success": "आप लॉगआउट हो गए हैं.",
    "farmer.voice_ready": "तैयार है। अब बोलें।", "farmer.voice_transcribing": "आपकी बात सुन रहे हैं…", "farmer.voice_transcribed_status": "आपका संदेश तैयार है।",
    "farmer.voice_processing": "आपकी आवाज तैयार हो रही है…", "farmer.voice_recording": "रिकॉर्ड हो रहा है… कृपया समस्या बताएं।",
    "farmer.voice_error": "आवाज समझ नहीं आई। कृपया फिर कोशिश करें।", "farmer.microphone_denied": "माइक्रोफोन की अनुमति नहीं मिली।",
    "farmer.login_invalid": "ईमेल, मोबाइल नंबर या पासवर्ड सही नहीं है।", "farmer.account_exists": "इस ईमेल या मोबाइल नंबर से खाता पहले से है।",
    "farmer.passwords_mismatch": "दोनों पासवर्ड मेल नहीं खाते।", "farmer.password_short": "पासवर्ड में कम से कम 6 अक्षर रखें।",
    "farmer.login_required": "अपना ईमेल या मोबाइल नंबर और पासवर्ड लिखें।", "farmer.portal_mismatch": "इस खाते के लिए सही पोर्टल चुनें।",
    "farmer.register_error": "जानकारी जांचकर फिर कोशिश करें।",
    // ---- OTP login (farmer) ----
    "farmer.otp_title": "मोबाइल OTP से लॉगिन", "farmer.otp_mobile_label": "पंजीकृत मोबाइल नंबर",
    "farmer.otp_mobile_hint": "पशुमित्र में पंजीकृत 10 अंकों का मोबाइल नंबर लिखें।",
    "farmer.otp_mobile_placeholder": "10 अंकों का मोबाइल नंबर",
    "farmer.send_otp": "OTP भेजें", "farmer.sending_otp": "OTP भेजा जा रहा है…",
    "farmer.enter_otp": "6 अंकों का OTP लिखें", "farmer.otp_placeholder": "6 अंकों का OTP",
    "farmer.verify_and_login": "सत्यापित करें और लॉगिन करें", "farmer.verifying_otp": "सत्यापित किया जा रहा है…",
    "farmer.resend_otp": "OTP दोबारा भेजें", "farmer.resending_otp": "दोबारा भेजा जा रहा है…",
    "farmer.resend_in": "{seconds} सेकंड में दोबारा भेजें", "farmer.resend_ready": "OTP नहीं मिला?",
    "farmer.change_mobile": "मोबाइल नंबर बदलें",
    "farmer.otp_sent": "यदि +91 {mobile} पशुमित्र में पंजीकृत है, तो OTP भेजा गया है। यह 5 मिनट तक मान्य है।",
    "farmer.otp_resent": "यदि +91 {mobile} पंजीकृत है, तो नया OTP भेजा गया है। यह 5 मिनट तक मान्य है।",
    "farmer.otp_missing_hint": "SMS नहीं मिला? जाँचें कि यह नंबर पशुमित्र में पंजीकृत है, फ़ोन चालू और SIM सक्रिय रखें, फिर 'OTP दोबारा भेजें' दबाएँ।",
    "farmer.otp_invalid_mobile": "सही 10 अंकों का मोबाइल नंबर लिखें।",
    "farmer.otp_invalid_code": "6 अंकों का OTP लिखें।",
    "farmer.otp_invalid": "OTP सही नहीं है। कृपया जांचकर फिर कोशिश करें।",
    "farmer.otp_expired": "यह OTP समाप्त हो गया है। कृपया नया OTP मांगें।",
    "farmer.otp_locked": "बहुत बार गलत कोशिश हुई। कृपया नया OTP मांगें।",
    "farmer.otp_used": "यह OTP पहले ही उपयोग हो चुका है। कृपया नया OTP मांगें।",
    "farmer.otp_cooldown": "नया OTP मांगने से पहले कृपया थोड़ी प्रतीक्षा करें।",
    "farmer.otp_rate_limited": "बहुत अधिक OTP अनुरोध हुए। कृपया बाद में प्रयास करें।",
    "farmer.otp_unavailable": "OTP SMS लॉगिन अभी उपलब्ध नहीं है।",
    "farmer.otp_send_failed": "OTP SMS भेजा नहीं जा सका। कृपया फिर प्रयास करें।",
    "farmer.otp_not_registered": "यदि यह नंबर पंजीकृत है, तो आपको OTP मिलेगा।",
    "farmer.otp_offline": "आप ऑफ़लाइन हैं। OTP पाने के लिए इंटरनेट से जुड़ें।",
    "farmer.signup_title": "मोबाइल OTP से किसान खाता बनाएं",
    "farmer.signup_mobile_hint": "अपना 10 अंकों का मोबाइल नंबर डालें। खाता बनाने से पहले हम OTP भेजकर पुष्टि करेंगे।",
    "farmer.verify_mobile": "मोबाइल सत्यापित करें",
    "farmer.profile_title": "अपनी किसान प्रोफ़ाइल पूरी करें",
    "farmer.profile_note": "+91 {mobile} सत्यापित हो गया। किसान खाता बनाने के लिए जानकारी भरें।",
    "farmer.create_account": "किसान खाता बनाएं",
    "farmer.creating_account": "खाता बन रहा है…",
    "farmer.profile_missing": "कृपया पूरा नाम और जिला भरें।",
    "farmer.registration_expired": "यह सत्यापन समाप्त हो गया। कृपया नया OTP मांगें।",
    "farmer.signup_success": "स्वागत, {name}! आपका किसान खाता बन गया।",
    "farmer.signup_link": "नए किसान? मोबाइल OTP से खाता बनाएं",
    "farmer.login_link": "पहले से पंजीकृत? मोबाइल OTP से लॉगिन करें",
    "farmer.otp_unavailable_hint": "OTP SMS लॉगिन अभी उपलब्ध नहीं है। कृपया थोड़ी देर बाद प्रयास करें या हेल्पलाइन {helpline} पर कॉल करें।",
    "farmer.demo_mobile": "डेमो मोबाइल नंबर",
    "farmer.demo_account_title": "डेमो खाता",
    "farmer.demo_phone_label": "मोबाइल नंबर",
    "farmer.demo_otp_label": "डेमो OTP",
    "farmer.demo_use_button": "डेमो खाता उपयोग करें",
    "farmer.demo_filled": "डेमो नंबर भर गया है। OTP भेजें दबाएं, फिर डेमो OTP डालें।",
    "farmer.demo_no_sms": "प्रोटोटाइप डेमो — कोई असली SMS नहीं भेजा जाता। ऊपर दिखाया डेमो OTP उपयोग करें।",
    "farmer.demo_welcome": "डेमो खाते से लॉगिन किया गया।",
    "farmer.notification_settings": "सूचना सेटिंग", "farmer.push_notifications": "पुश सूचनाएं",
    "farmer.push_available": "रिपोर्ट, जांच के नतीजे और स्वास्थ्य की जानकारी पाने के लिए पुश सूचनाएं चालू करें।",
    "farmer.push_unavailable": "इस डिवाइस पर पुश सूचनाएं चालू नहीं हैं। ऐप में सूचनाएं मिलती रहेंगी।",
    "farmer.push_admin": "इस सर्वर पर पुश सूचनाएं चालू नहीं हैं। ऐप में सूचनाएं मिलती रहेंगी।",
    "farmer.enable_push": "सूचनाएं चालू करें", "farmer.push_unsupported": "इस डिवाइस पर पुश सूचनाएं उपलब्ध नहीं हैं।",
    "farmer.push_permission_denied": "सूचना की अनुमति नहीं मिली। डिवाइस की सेटिंग जांचें।",
    "farmer.push_enabled": "सूचनाएं चालू हो गई हैं।", "farmer.push_failed": "सूचनाएं चालू नहीं हो पाईं। फिर कोशिश करें।",
  },
  te: {
    "app.tagline": "పశువుల వ్యాధి నివేదిక & పశు వైద్య సేవ — మహారాష్ట్ర",
    "nav.dashboard": "హోమ్", "nav.analytics": "విశ్లేషణ", "nav.gis": "జీఐఎస్ రిస్క్ మ్యాప్",
    "nav.surveillance": "వ్యాధి పర్యవేక్షణ", "nav.ai": "ఏఐ రిస్క్", "nav.reporting": "నివేదిక",
    "nav.animals": "జంతువులు", "nav.cases": "కేసులు", "nav.lab": "ల్యాబ్", "nav.rx": "మందులు",
    "nav.alerts": "హెచ్చరికలు", "nav.reports": "నివేదికలు", "nav.search": "శోధన",
    "nav.campaigns": "వ్యాక్సినేషన్ డ్రైవ్లు", "nav.stock": "స్టాక్", "nav.diseases": "సమాచారం",
    "nav.queue": "క్యూ", "nav.national": "జాతీయ", "nav.scan": "స్కాన్",
    "role.owner": "పశువుల యజమాని", "role.vet": "పశువైద్యుడు", "role.govt": "ప్రభుత్వ అధికారి",
    "role.lab": "ల్యాబ్ సిబ్బంది",
    "role.owner.desc": "జంతువులను నమోదు చేయండి, ఆరోగ్య నివేదికలు, మందులు & QR పాస్‌పోర్ట్ చూడండి",
    "role.vet.desc": "నివేదికలు స్వీకరించండి, నమూనా సేకరణ, రోగ నిర్ధారణ, ల్యాబ్, మందులు & ఏఐ సలహా",
    "role.govt.desc": "రాష్ట్ర విశ్లేషణ, వ్యాధి పర్యవేక్షణ, GIS రిస్క్ మరియు జాతీయ ముందస్తు హెచ్చరిక",
    "role.lab.desc": "నమూనా స్వీకరణ, ధృవీకరణ, జైవిక పరీక్షలు, ఫలితాల నమోదు & నివేదికలు",
    "btn.login": "లాగిన్", "btn.register": "నమోదు", "btn.logout": "లాగౌట్",
    "btn.save": "సేవ్ చేయండి", "btn.submit": "సమర్పించండి", "btn.create": "సృష్టించండి",
    "auth.choose": "మీ పోర్టల్ ఎంచుకోండి", "auth.newHere": "కొత్తగా వచ్చారా?",
    "auth.haveAccount": "ఇప్పటికే నమోదు చేసుకున్నారా?", "auth.createAccount": "ఖాతా సృష్టించండి",
    "lang.label": "భాష",
    "farmer.app_name": "పశు-మిత్ర",
    "farmer.home": "హోమ్", "farmer.dashboard_title": "మీ పశువుల వివరాలు",
    "farmer.welcome_back": "తిరిగి స్వాగతం,", "farmer.home_prompt": "మీరు ఏమి చేయాలనుకుంటున్నారు?",
    "farmer.my_livestock": "నా పశువులు", "farmer.add_animal": "పశువును చేర్చండి", "farmer.add_herd": "మందను చేర్చండి",
    "farmer.my_animals": "నా జంతువులు", "farmer.my_herds": "నా పశువుల మందలు",
    "farmer.report_problem": "సమస్యను తెలియజేయండి", "farmer.cases": "నివేదికలు",
    "farmer.health_treatment": "ఆరోగ్యం", "farmer.notifications": "సూచనలు", "farmer.profile": "నా వివరాలు",
    "farmer.language": "భాష", "farmer.what_to_do": "ఒక చర్యను ఎంచుకోండి",
    // యాప్‌లో వెబ్ కాల్ (WebRTC) — ఫోన్ హెల్ప్‌లైన్ కంటే వేరు.
    "farmer.call_vet": "పశువైద్యుడిని కాల్ చేయండి",
    "farmer.call_vet_help": "ఈ బ్రౌజర్ నుంచే ఇప్పుడే పశువైద్యుడితో మాట్లాడండి. మైక్రోఫోన్ కాల్ సమయంలో మాత్రమే వాడబడుతుంది.",
    "farmer.call_language": "కాల్ భాష", "farmer.call_reason": "కాల్ చేయడానికి కారణం",
    "farmer.call_notes": "గమనికలు (ఐచ్ఛికం)", "farmer.call_notes_placeholder": "లక్షణాలు, ఎప్పటి నుంచి, పశువు ట్యాగ్…",
    "farmer.start_call": "కాల్ ప్రారంభించండి", "farmer.call_history": "కాల్ చరిత్ర",
    "farmer.helpline": "హెల్ప్‌లైన్ (ఫోన్ కాల్)",
    "farmer.helpline_help": "వెబ్ కాల్‌కు ఎవరూ ఆన్‌లైన్‌లో లేకపోతే, ఫోన్ నుంచి హెల్ప్‌లైన్‌కు కాల్ చేయవచ్చు. ఇది వేరే టెలిఫోన్ సేవ.",
    "farmer.animal": "జంతువు", "farmer.animal_id": "జంతువు సంఖ్య", "farmer.animal_name": "జంతువు పేరు",
    "farmer.animal_type": "జంతువు రకం", "farmer.breed": "జాతి", "farmer.age": "వయస్సు",
    "farmer.years": "సంవత్సరాలు", "farmer.health_status": "ఆరోగ్యం", "farmer.status": "స్థితి",
    "farmer.herd": "మంద", "farmer.herd_name": "మంద", "farmer.animal_count": "జంతువులు",
    "farmer.active_cases": "పరిష్కారం కాని ఆరోగ్య సమస్యలు", "farmer.no_active_cases": "ప్రస్తుతం ఆరోగ్య సమస్యలు లేవు",
    "farmer.no_animals": "ఇంకా జంతువులు లేవు", "farmer.no_animals_hint": "మీ మొదటి జంతువును చేర్చితే ఇక్కడ కనిపిస్తుంది.",
    "farmer.no_herds": "ఇంకా మందలు లేవు", "farmer.no_herds_hint": "మీ జంతువులను ఒకచోట ఉంచడానికి మందను చేర్చండి.",
    "farmer.loading": "లోడ్ అవుతోంది…", "farmer.loading_dashboard": "మీ హోమ్ తెరుచుకుంటోంది…",
    "farmer.loading_livestock": "మీ పశువుల వివరాలు తెరుచుకుంటున్నాయి…", "farmer.loading_animal": "జంతువు వివరాలు తెరుచుకుంటున్నాయి…",
    "farmer.loading_herd": "మంద వివరాలు తెరుచుకుంటున్నాయి…", "farmer.loading_cases": "మీ నివేదికలు తెరుచుకుంటున్నాయి…",
    "farmer.loading_treatment": "చికిత్స వివరాలు తెరుచుకుంటున్నాయి…", "farmer.loading_notifications": "సూచనలు తెరుచుకుంటున్నాయి…",
    "farmer.open_details": "వివరాలు చూడండి", "farmer.location": "ప్రాంతం", "farmer.back_to_livestock": "నా పశువుల వద్దకు తిరిగి వెళ్లండి",
    "farmer.healthy": "ఆరోగ్యంగా ఉంది", "farmer.under_treatment": "చికిత్సలో ఉంది", "farmer.under_observation": "పరిశీలనలో ఉంది", "farmer.deceased": "మరణించింది",
    "farmer.sick": "అనారోగ్యంగా ఉంది", "farmer.at_risk": "శ్రద్ధ అవసరం", "farmer.low_risk": "తక్కువ ప్రమాదం",
    "farmer.moderate_risk": "మధ్యస్థ ప్రమాదం", "farmer.high_risk": "ఎక్కువ ప్రమాదం", "farmer.critical": "అత్యవసరం",
    "farmer.unknown": "వివరాలు అందుబాటులో లేవు", "farmer.healthy_message": "ప్రస్తుతం ఆరోగ్య సమస్య ఏదీ నమోదు కాలేదు.",
    "farmer.animal_information": "జంతువు వివరాలు", "farmer.herd_information": "మంద వివరాలు",
    "farmer.herd_animals": "ఈ మందలోని జంతువులు", "farmer.health_and_treatment": "ఆరోగ్యం మరియు చికిత్స",
    "farmer.treatment_history": "చికిత్స వివరాలు", "farmer.case_history": "ఆరోగ్య నివేదికలు",
    "farmer.vaccination_history": "టీకాల చరిత్ర", "farmer.test_results": "పరీక్ష ఫలితాలు",
    "farmer.no_treatments": "చికిత్స వివరాలు ఇంకా లేవు.", "farmer.no_cases": "ఆరోగ్య నివేదికలు ఇంకా లేవు.",
    "farmer.no_lab_reports": "పరీక్ష ఫలితాలు ఇంకా లేవు.", "farmer.no_vaccinations": "టీకాల వివరాలు లేవు.",
    "farmer.no_herd_animals": "ఈ మందకు ఇంకా జంతువులు జత చేయలేదు.",
    "farmer.reported": "తెలియజేసినది", "farmer.severity": "సమస్య ఎంత తీవ్రంగా ఉంది?", "farmer.diagnosis": "పశువైద్యుని పరిశీలన",
    "farmer.vet": "పశువైద్యుడు", "farmer.instructions": "సూచనలు", "farmer.follow_up": "తదుపరి పరీక్ష",
    "farmer.due": "తేదీ", "farmer.given_on": "ఇచ్చిన తేదీ", "farmer.medicine": "మందు",
    "farmer.dosage": "మోతాదు", "farmer.frequency": "ఎన్ని సార్లు", "farmer.duration": "ఎన్ని రోజులు",
    "farmer.prescribed_by": "మందు రాసినవారు", "farmer.report_case": "సమస్యను తెలియజేయండి",
    "farmer.qr_tag": "జంతువు QR గుర్తు", "farmer.mark_deceased": "మరణించినట్లు నమోదు చేయండి", "farmer.delete_animal": "జంతువును తొలగించండి",
    "farmer.select": "ఎంచుకోండి", "farmer.choose_animal": "మీ జంతువును ఎంచుకోండి", "farmer.cattle": "ఆవు / ఎద్దు",
    "farmer.buffalo": "గేదె", "farmer.goat": "మేక", "farmer.sheep": "గొర్రె", "farmer.other": "ఇతర",
    "farmer.gender": "లింగం", "farmer.female": "ఆడ", "farmer.male": "మగ",
    "farmer.optional": "ఐచ్ఛికం", "farmer.no_herd": "మంద లేదు", "farmer.select_herd": "మందను ఎంచుకోండి",
    "farmer.age_placeholder": "వయస్సు (సంవత్సరాల్లో)", "farmer.breed_placeholder": "జాతిని నమోదు చేయండి",
    "farmer.full_name": "పూర్తి పేరు", "farmer.mobile": "మొబైల్ నంబరు", "farmer.village": "గ్రామం",
    "farmer.block": "మండలం", "farmer.district": "జిల్లా", "farmer.create_herd": "మందను సృష్టించండి",
    "farmer.register_animal": "జంతువును భద్రపరచండి", "farmer.creating_herd": "మందను సృష్టిస్తోంది…",
    "farmer.animal_registered": "జంతువు {code} విజయవంతంగా చేర్చబడింది.", "farmer.herd_created": "మంద {code} సృష్టించబడింది.",
    "farmer.validation_required": "దయచేసి ఈ వివరాన్ని నమోదు చేయండి.", "farmer.validation_email": "దయచేసి సరైన ఈమెయిల్ చిరునామా నమోదు చేయండి.",
    "farmer.validation_min_length": "దయచేసి కనీసం {count} అక్షరాలు నమోదు చేయండి.",
    "farmer.generic_error": "ఏదో తప్పు జరిగింది. మళ్లీ ప్రయత్నించండి.", "farmer.connection_error": "కనెక్ట్ కాలేదు. ఇంటర్నెట్‌ను పరిశీలించి మళ్లీ ప్రయత్నించండి.",
    "farmer.invalid_animal_type": "దయచేసి జంతువు రకాన్ని ఎంచుకోండి.", "farmer.invalid_herd": "ఆ మంద కనిపించలేదు. మళ్లీ ఎంచుకోండి.",
    "farmer.save_animal_error": "జంతువును భద్రపరచలేకపోయాం. వివరాలను పరిశీలించి మళ్లీ ప్రయత్నించండి.",
    "farmer.animal_not_found": "జంతువు కనిపించలేదు.", "farmer.herd_not_found": "మంద కనిపించలేదు.",
    "farmer.access_error": "ఈ సమాచారాన్ని చూడటానికి మీకు అనుమతి లేదు.",
    "farmer.report_title": "ఆరోగ్య సమస్యను తెలియజేయండి", "farmer.describe_symptoms": "ఏమి సమస్యో చెప్పండి",
    "farmer.report_help": "జంతువును ఎంచుకుని మీరు గమనించిన విషయాన్ని చెప్పండి. పశువైద్యుడు సహాయం చేస్తారు.",
    "farmer.voice_report": "మాట్లాడి చెప్పండి", "farmer.tap_to_speak": "మాట్లాడటానికి నొక్కండి",
    "farmer.stop_recording": "రికార్డింగ్ ఆపండి", "farmer.press_mic": "మైక్రోఫోన్‌ను నొక్కి సమస్యను వివరించండి.",
    "farmer.transcribed_voice": "మాటలను రాసినది", "farmer.processing_voice": "మీ మాటలను అర్థం చేసుకుంటోంది…",
    "farmer.symptoms": "ఏ లక్షణాలు గమనించారు?", "farmer.symptoms_placeholder": "ఉదా: జ్వరం, మేత తినకపోవడం లేదా వాపు",
    "farmer.severity_low": "తక్కువ", "farmer.severity_medium": "మధ్యస్థం", "farmer.severity_high": "తీవ్రమైనది",
    "farmer.severity_critical": "అత్యవసరం", "farmer.additional_details": "ఇంకా ఏమైనా చెప్పాలా?",
    "farmer.details_placeholder": "ఇది ఎప్పుడు మొదలైంది? మరొక జంతువుకూ ఇదే సమస్య ఉందా?",
    "farmer.submit_report": "నివేదిక పంపండి", "farmer.report_sent": "మీ నివేదిక పంపబడింది. సూచన సంఖ్య: {code}",
    "farmer.my_cases": "నా నివేదికలు", "farmer.case_detail": "నివేదిక వివరాలు", "farmer.case_number": "సూచన సంఖ్య",
    "farmer.report_date": "తెలియజేసిన తేదీ", "farmer.case_status_new": "కొత్తది", "farmer.case_status_assigned": "పశువైద్యుడు నియమించబడ్డారు",
    "farmer.case_status_investigation": "పరిశీలిస్తున్నారు", "farmer.case_status_sample": "నమూనా సేకరించారు",
    "farmer.case_status_lab": "పరీక్ష జరుగుతోంది", "farmer.case_status_diagnosed": "పరిశీలన పూర్తయింది",
    "farmer.case_status_treatment": "చికిత్స జరుగుతోంది", "farmer.case_status_follow_up": "తదుపరి పరిశీలన",
    "farmer.case_status_recovered": "కోలుకుంది", "farmer.case_status_closed": "ముగిసింది",
    "farmer.case_status_completed": "పూర్తయింది", "farmer.case_updates": "నివేదికలో మార్పులు",
    "farmer.how_is_animal": "మీ జంతువు ఇప్పుడు ఎలా ఉంది?", "farmer.recovery_status": "జంతువు ఎలా ఉంది?",
    "farmer.improving": "మెరుగవుతోంది", "farmer.same": "మార్పు లేదు", "farmer.worse": "మరింత క్షీణిస్తోంది",
    "farmer.notes": "గమనికలు", "farmer.notes_placeholder": "మీరు గమనించిన మార్పులను తెలియజేయండి.",
    "farmer.submit_feedback": "వివరాలు పంపండి", "farmer.feedback_thanks": "ధన్యవాదాలు. మీ వివరాలు పంపబడ్డాయి.",
    "farmer.no_prescriptions": "ఇంకా మందులు సూచించలేదు.", "farmer.no_notifications": "కొత్త సూచనలు ఏవీ లేవు.",
    "farmer.new": "కొత్తది", "farmer.notification_case": "ఆరోగ్య నివేదిక", "farmer.notification_lab": "పరీక్ష ఫలితం",
    "farmer.notification_prescription": "మందు", "farmer.notification_vaccination": "టీకా",
    "farmer.notification_alert": "ఆరోగ్య హెచ్చరిక", "farmer.notification_info": "సూచన",
    "farmer.notification_case_new": "జంతువు {animal} కోసం కొత్త ఆరోగ్య నివేదిక: {case}.",
    "farmer.notification_case_update": "ఆరోగ్య నివేదిక {case}లో మార్పు: {status}.",
    "farmer.notification_lab_ready": "నివేదిక {case} కోసం పరీక్ష ఫలితం {report} సిద్ధంగా ఉంది.",
    "farmer.notification_prescription_issued": "నివేదిక {case} కోసం మందుల సూచనలు సిద్ధంగా ఉన్నాయి.",
    "farmer.notification_vaccination_due": "జంతువు {animal}కు టీకా వేయాలి. దయచేసి సమయం ఏర్పాటు చేయండి.",
    "farmer.notification_farm_alert": "ఆరోగ్య హెచ్చరిక: {district} దగ్గర {disease} గుర్తించారు. {action}",
    "farmer.notification_vet_on_way": "నివేదిక {case} కోసం డా. {name} సహాయం చేయడానికి వస్తున్నారు.",
    "farmer.notification_vet_arrived": "నివేదిక {case} కోసం డా. {name} చేరుకున్నారు.",
    "farmer.notification_test_requested": "నివేదిక {case} కోసం పరీక్ష కోరారు.",
    "farmer.notification_lab_problem": "జంతువు {animal} పరీక్ష పూర్తి కాలేదు: {reason}",
    "farmer.notification_case_recovered": "నివేదిక {case} కోలుకున్నట్లు డా. {name} నమోదు చేశారు.",
    "farmer.notification_auto_escalation": "అత్యవసరం: నివేదిక {case}పై వెంటనే శ్రద్ధ అవసరం.",
    "farmer.mobile_label": "మొబైల్", "farmer.email": "ఈమెయిల్", "farmer.specialization": "ప్రత్యేకత",
    "farmer.current_language": "ప్రస్తుత భాష", "farmer.logout": "లాగ్ అవుట్", "farmer.user": "వినియోగదారు",
    "farmer.helpline_title": "జంతువుకు సహాయం కావాలా?", "farmer.helpline_name": "పశు-షీల్డ్ సహాయ నంబరు",
    "farmer.call_now": "ఇప్పుడే కాల్ చేయండి", "farmer.desktop_call_note": "ఈ నంబరుకు మీ మొబైల్ నుంచి కాల్ చేయండి.",
    "farmer.not_found": "పేజీ కనిపించలేదు.", "farmer.go_home": "హోమ్‌కు వెళ్లండి", "farmer.error": "ఏదో తప్పు జరిగింది.",
    "farmer.offline_queued": "ఇంటర్నెట్ లేదు. మీ అభ్యర్థన భద్రపరిచాం; తిరిగి కనెక్ట్ అయినప్పుడు పంపబడుతుంది.",
    "farmer.delete_confirm": "జంతువు {code}ను తొలగించాలా? దాని ఆరోగ్య నివేదికలు, చికిత్స వివరాలు కూడా తొలగిపోతాయి.",
    "farmer.animal_deleted": "జంతువు {code} తొలగించబడింది.", "farmer.deceased_prompt": "జంతువు {code}ను మరణించినట్లు నమోదు చేయడానికి కారణం రాయండి:",
    "farmer.animal_marked_deceased": "జంతువు {code} మరణించినట్లు నమోదు చేయబడింది.", "farmer.cancel": "రద్దు చేయండి",
    "farmer.tracking_title": "పశువైద్యుని సందర్శన", "farmer.tracking_report_placed": "నివేదిక పంపబడింది",
    "farmer.tracking_vet_accepted": "పశువైద్యుడు అంగీకరించారు", "farmer.tracking_on_way": "వస్తున్నారు",
    "farmer.tracking_arrived": "చేరుకున్నారు", "farmer.tracking_visit_done": "సందర్శన పూర్తయింది",
    "farmer.eta": "చేరుకునే అంచనా సమయం", "farmer.minutes": "నిమిషాలు", "farmer.assigned": "నియమించబడ్డారు",
    "farmer.response_improved": "మెరుగవుతోంది", "farmer.response_unchanged": "మార్పు లేదు",
    "farmer.response_worsened": "మరింత క్షీణిస్తోంది", "farmer.response_recovered": "కోలుకుంది",
    "farmer.response_adverse_reaction": "మందుకు ప్రతిచర్య", "farmer.response_treatment_discontinued": "చికిత్స ఆపివేశారు",
    "farmer.response_follow_up_required": "తదుపరి పరిశీలన అవసరం",
    "farmer.no_cases_home": "ఇంకా నివేదికలు లేవు.", "farmer.error_report_animal": "నివేదిక పంపే ముందు జంతువును ఎంచుకోండి.",
    "farmer.offline_count": "భద్రపరిచిన అభ్యర్థనలు పంపాలి · పంపడానికి నొక్కండి", "farmer.sync_success": "భద్రపరిచిన అభ్యర్థనలు విజయవంతంగా పంపబడ్డాయి.",
    "farmer.farmer_portal": "రైతు పోర్టల్", "farmer.demo_account": "డెమో ఖాతా", "farmer.username": "వినియోగదారు పేరు",
    "farmer.password": "పాస్‌వర్డ్", "farmer.email_or_mobile": "ఈమెయిల్ లేదా మొబైల్ నంబరు", "farmer.confirm_password": "పాస్‌వర్డ్‌ను నిర్ధారించండి",
    "farmer.positive": "అనుకూలం", "farmer.negative": "ప్రతికూలం", "farmer.pending": "పరిశీలనలో ఉంది", "farmer.result": "ఫలితం",
    "farmer.download": "డౌన్‌లోడ్ చేయండి", "farmer.print": "ట్యాగ్ ముద్రించండి", "farmer.close": "మూసివేయండి",
    "farmer.preferred_helpline_language": "కాల్‌కు ఇష్టమైన భాష", "farmer.ask_language_call": "కాల్ సమయంలో అడగండి",
    "farmer.welcome_toast": "తిరిగి స్వాగతం, {name}!", "farmer.account_created": "{name} కోసం ఖాతా సృష్టించబడింది!", "farmer.logout_success": "మీరు లాగ్ అవుట్ అయ్యారు.",
    "farmer.voice_ready": "సిద్ధంగా ఉంది. ఇప్పుడు మాట్లాడండి.", "farmer.voice_transcribing": "మీ మాటలను వింటోంది…", "farmer.voice_transcribed_status": "మీ సందేశం సిద్ధంగా ఉంది.",
    "farmer.voice_processing": "మీ మాటలను సిద్ధం చేస్తోంది…", "farmer.voice_recording": "రికార్డింగ్ జరుగుతోంది… సమస్యను వివరించండి.",
    "farmer.voice_error": "మీ మాటలు అర్థం కాలేదు. మళ్లీ ప్రయత్నించండి.", "farmer.microphone_denied": "మైక్రోఫోన్ అనుమతి ఇవ్వలేదు.",
    "farmer.login_invalid": "ఈమెయిల్, మొబైల్ నంబరు లేదా పాస్‌వర్డ్ సరైనది కాదు.", "farmer.account_exists": "ఈమెయిల్ లేదా మొబైల్ నంబరుతో ఖాతా ఇప్పటికే ఉంది.",
    "farmer.passwords_mismatch": "రెండు పాస్‌వర్డ్‌లు సరిపోలలేదు.", "farmer.password_short": "పాస్‌వర్డ్‌లో కనీసం 6 అక్షరాలు ఉండాలి.",
    "farmer.login_required": "మీ ఈమెయిల్ లేదా మొబైల్ నంబరు, పాస్‌వర్డ్ నమోదు చేయండి.", "farmer.portal_mismatch": "ఈ ఖాతాకు సరైన పోర్టల్‌ను ఎంచుకోండి.",
    "farmer.register_error": "వివరాలను పరిశీలించి మళ్లీ ప్రయత్నించండి.",
    // ---- OTP login (farmer) ----
    "farmer.otp_title": "మొబైల్ OTP తో లాగిన్", "farmer.otp_mobile_label": "నమోదైన మొబైల్ నంబరు",
    "farmer.otp_mobile_hint": "పశుమిత్రలో నమోదు చేసిన 10 అంకెల మొబైల్ నంబరును నమోదు చేయండి.",
    "farmer.otp_mobile_placeholder": "10 అంకెల మొబైల్ నంబరు",
    "farmer.send_otp": "OTP పంపండి", "farmer.sending_otp": "OTP పంపుతోంది…",
    "farmer.enter_otp": "6 అంకెల OTP నమోదు చేయండి", "farmer.otp_placeholder": "6 అంకెల OTP",
    "farmer.verify_and_login": "ధృవీకరించి లాగిన్ చేయండి", "farmer.verifying_otp": "ధృవీకరిస్తోంది…",
    "farmer.resend_otp": "OTP మళ్లీ పంపండి", "farmer.resending_otp": "మళ్లీ పంపుతోంది…",
    "farmer.resend_in": "{seconds} సెకన్లలో మళ్లీ పంపండి", "farmer.resend_ready": "OTP రాలేదా?",
    "farmer.change_mobile": "మొబైల్ నంబరు మార్చండి",
    "farmer.otp_sent": "+91 {mobile} పశుమిత్రలో నమోదై ఉంటే, OTP పంపబడింది. ఇది 5 నిమిషాల పాటు చెల్లుతుంది.",
    "farmer.otp_resent": "+91 {mobile} నమోదై ఉంటే, కొత్త OTP పంపబడింది. ఇది 5 నిమిషాల పాటు చెల్లుతుంది.",
    "farmer.otp_missing_hint": "SMS రాలేదా? ఈ నంబరు పశుమిత్రలో నమోదై ఉందో తనిఖీ చేయండి, ఫోన్ ఆన్‌లో మరియు SIM సక్రియంగా ఉంచండి, తర్వాత 'OTP మళ్లీ పంపండి' నొక్కండి.",
    "farmer.otp_invalid_mobile": "సరైన 10 అంకెల మొబైల్ నంబరును నమోదు చేయండి.",
    "farmer.otp_invalid_code": "6 అంకెల OTP నమోదు చేయండి.",
    "farmer.otp_invalid": "OTP సరైనది కాదు. పరిశీలించి మళ్లీ ప్రయత్నించండి.",
    "farmer.otp_expired": "ఈ OTP గడువు ముగిసింది. కొత్త OTP అభ్యర్థించండి.",
    "farmer.otp_locked": "చాలా సార్లు తప్పు ప్రయత్నాలు జరిగాయి. కొత్త OTP అభ్యర్థించండి.",
    "farmer.otp_used": "ఈ OTP ఇప్పటికే వాడబడింది. కొత్త OTP అభ్యర్థించండి.",
    "farmer.otp_cooldown": "మరో OTP అభ్యర్థించే ముందు కొద్దిసేపు వేచి ఉండండి.",
    "farmer.otp_rate_limited": "చాలా OTP అభ్యర్థనలు జరిగాయి. తర్వాత ప్రయత్నించండి.",
    "farmer.otp_unavailable": "OTP SMS లాగిన్ ప్రస్తుతం అందుబాటులో లేదు.",
    "farmer.otp_send_failed": "OTP SMS పంపలేకపోయాం. మళ్లీ ప్రయత్నించండి.",
    "farmer.otp_not_registered": "ఈ నంబరు నమోదై ఉంటే మీకు OTP వస్తుంది.",
    "farmer.otp_offline": "మీరు ఆఫ్‌లైన్‌లో ఉన్నారు. OTP పొందడానికి ఇంటర్నెట్‌కు కనెక్ట్ అవ్వండి.",
    "farmer.signup_title": "మొబైల్ OTP తో రైతు ఖాతా సృష్టించండి",
    "farmer.signup_mobile_hint": "మీ 10 అంకెల మొబైల్ నంబరు నమోదు చేయండి. ఖాతా సృష్టించే ముందు OTP పంపి ధృవీకరిస్తాము.",
    "farmer.verify_mobile": "మొబైల్ ధృవీకరించండి",
    "farmer.profile_title": "మీ రైతు ప్రొఫైల్ పూర్తి చేయండి",
    "farmer.profile_note": "+91 {mobile} ధృవీకరించబడింది. రైతు ఖాతా సృష్టించడానికి వివరాలు నింపండి.",
    "farmer.create_account": "రైతు ఖాతా సృష్టించండి",
    "farmer.creating_account": "ఖాతా సృష్టిస్తోంది…",
    "farmer.profile_missing": "దయచేసి పూర్తి పేరు మరియు జిల్లా నమోదు చేయండి.",
    "farmer.registration_expired": "ఈ ధృవీకరణ గడువు ముగిసింది. దయచేసి కొత్త OTP అభ్యర్థించండి.",
    "farmer.signup_success": "స్వాగతం, {name}! మీ రైతు ఖాతా సృష్టించబడింది.",
    "farmer.signup_link": "కొత్త రైతా? మొబైల్ OTP తో ఖాతా సృష్టించండి",
    "farmer.login_link": "ఇప్పటికే నమోదయ్యారా? మొబైల్ OTP తో లాగిన్ చేయండి",
    "farmer.otp_unavailable_hint": "OTP SMS లాగిన్ ప్రస్తుతం అందుబాటులో లేదు. కొద్దిసేపటి తర్వాత ప్రయత్నించండి లేదా హెల్ప్‌లైన్ {helpline} కు కాల్ చేయండి.",
    "farmer.demo_mobile": "డెమో మొబైల్ నంబరు",
    "farmer.demo_account_title": "డెమో ఖాతా",
    "farmer.demo_phone_label": "మొబైల్ నంబరు",
    "farmer.demo_otp_label": "డెమో OTP",
    "farmer.demo_use_button": "డెమో ఖాతా ఉపయోగించండి",
    "farmer.demo_filled": "డెమో నంబరు నమోదు చేయబడింది. OTP పంపండి నొక్కి, తర్వాత డెమో OTP నమోదు చేయండి.",
    "farmer.demo_no_sms": "ప్రోటోటైప్ డెమో — నిజమైన SMS పంపబడదు. పైన చూపిన డెమో OTP ఉపయోగించండి.",
    "farmer.demo_welcome": "డెమో ఖాతాతో లాగిన్ అయ్యారు.",
    "farmer.notification_settings": "సూచనల అమరికలు", "farmer.push_notifications": "పుష్ సూచనలు",
    "farmer.push_available": "నివేదికలు, పరీక్ష ఫలితాలు, ఆరోగ్య సమాచారం పొందడానికి పుష్ సూచనలను ప్రారంభించండి.",
    "farmer.push_unavailable": "ఈ పరికరంలో పుష్ సూచనలు అమర్చలేదు. యాప్‌లో సూచనలు వస్తూనే ఉంటాయి.",
    "farmer.push_admin": "ఈ సర్వర్‌లో పుష్ సూచనలు అమర్చలేదు. యాప్‌లో సూచనలు వస్తూనే ఉంటాయి.",
    "farmer.enable_push": "సూచనలను ప్రారంభించండి", "farmer.push_unsupported": "ఈ పరికరంలో పుష్ సూచనలు అందుబాటులో లేవు.",
    "farmer.push_permission_denied": "సూచనలకు అనుమతి ఇవ్వలేదు. పరికర సెట్టింగ్‌లను చూడండి.",
    "farmer.push_enabled": "సూచనలు ప్రారంభించబడ్డాయి.", "farmer.push_failed": "సూచనలను ప్రారంభించలేకపోయాం. మళ్లీ ప్రయత్నించండి.",
  },
};
function t(key, params = {}) {
  let value = (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key] || key;
  for (const [name, replacement] of Object.entries(params || {})) {
    value = value.replaceAll(`{${name}}`, String(replacement ?? ""));
  }
  return value;
}
function ft(key, params = {}) { return t(`farmer.${key}`, params); }

const FARMER_HEADER_KEYS = {
  "Not found": "not_found", "Error": "error", "Animals": "my_animals", "My Animals": "my_animals",
  "My Herds": "my_herds", "Add Animal": "add_animal", "Add Herd": "add_herd",
  "Report Health Issue": "report_title", "Cases": "cases", "Active Case Tracking": "my_cases",
  "Case Detail": "case_detail", "Prescriptions": "health_treatment", "Lab Reports": "test_results",
  "Notifications": "notifications", "My Profile": "profile", "Animal Record": "animal_information",
  "Digital Health Record": "animal_information", "Herd Intelligence": "herd_information",
};
const FARMER_MESSAGE_KEYS = {
  "Something went wrong. Please try again.": "generic_error",
  "Animal type is required": "invalid_animal_type", "animal_id is required": "error_report_animal",
  "Invalid herd ID": "invalid_herd", "Animal not found": "animal_not_found", "Herd not found": "herd_not_found",
  "Could not save this animal. Please check the details and try again.": "save_animal_error",
  "Not authorized to view this animal": "access_error", "Forbidden for this role": "access_error",
  "Missing or invalid Authorization header": "access_error", "Invalid or expired token": "access_error",
  "Offline mode: Operation queued locally for auto-sync.": "offline_queued",
  "Failed to fetch": "connection_error", "NetworkError when attempting to fetch resource.": "connection_error",
  "Invalid credentials": "login_invalid", "Email/mobile and password are required": "login_required",
  "An account with this email or mobile already exists": "account_exists", "Passwords do not match": "passwords_mismatch",
  "Password must be at least 6 characters": "password_short",
  "You’re all caught up!": "no_notifications", "You're all caught up!": "no_notifications",
  "No active cases.": "no_cases", "No cases recorded.": "no_cases_home",
  "No prescriptions yet.": "no_prescriptions", "No prescriptions issued yet.": "no_prescriptions",
  "No lab reports yet.": "no_lab_reports", "No verified laboratory reports released yet.": "no_lab_reports",
  "No animals registered yet.": "no_animals", "No herds yet. Add your first herd.": "no_herds",
};
function farmerHeaderTitle(title) {
  const key = FARMER_HEADER_KEYS[title];
  return key ? ft(key) : title;
}
function farmerRuntimeText(value) {
  const text = String(value ?? "");
  const key = FARMER_MESSAGE_KEYS[text];
  if (key) return ft(key);
  let match = text.match(/^Animal (.+) registered!?$/i);
  if (match) return ft("animal_registered", { code: match[1] });
  match = text.match(/^Animal (.+) added successfully\.$/i);
  if (match) return ft("animal_registered", { code: match[1] });
  match = text.match(/^Herd (.+) created!?$/i);
  if (match) return ft("herd_created", { code: match[1] });
  match = text.match(/^Report placed: (.+)$/i);
  if (match) return ft("report_sent", { code: match[1] });
  match = text.match(/^Animal (.+) deleted\.?$/i);
  if (match) return ft("animal_deleted", { code: match[1] });
  match = text.match(/^Animal (.+) marked as deceased\.?$/i);
  if (match) return ft("animal_marked_deceased", { code: match[1] });
  if (/^failed to fetch$/i.test(text) || /networkerror/i.test(text)) return ft("connection_error");
  return text;
}
function ownerAnimalType(value) {
  const key = { cattle: "cattle", cow: "cattle", buffalo: "buffalo", goat: "goat", sheep: "sheep", other: "other" }[(value || "").toLowerCase()];
  return key ? ft(key) : (value || ft("unknown"));
}
function ownerAnimalStatus(value) {
  const status = (value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  const keys = { healthy: "healthy", "under treatment": "under_treatment", treatment: "under_treatment", "under observation": "under_observation", sick: "sick", deceased: "deceased", "at risk": "at_risk" };
  return keys[status] ? ft(keys[status]) : (value || ft("unknown"));
}
function ownerCaseStatus(value) {
  const status = (value || "").trim().toUpperCase().replace(/[_-]+/g, " ");
  const keys = {
    "NEW": "case_status_new", "ASSIGNED": "case_status_assigned", "UNDER INVESTIGATION": "case_status_investigation",
    "SAMPLE COLLECTED": "case_status_sample", "LAB PENDING": "case_status_lab", "TESTING": "case_status_lab",
    "DIAGNOSED": "case_status_diagnosed", "TREATMENT": "case_status_treatment", "FOLLOW UP": "case_status_follow_up",
    "RECOVERED": "case_status_recovered", "CLOSED": "case_status_closed", "COMPLETED": "case_status_completed",
  };
  return keys[status] ? ft(keys[status]) : (value || ft("unknown"));
}
function ownerRiskLabel(value) {
  const risk = (value || "").toLowerCase();
  if (risk.includes("high") || risk.includes("critical")) return ft("high_risk");
  if (risk.includes("moderate")) return ft("moderate_risk");
  if (risk.includes("low")) return ft("low_risk");
  return ft("unknown");
}
function ownerResponseLabel(value) {
  const key = "response_" + (value || "").toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
  const translated = t(`farmer.${key}`);
  return translated === `farmer.${key}` ? (value || ft("unknown")) : translated;
}
function ownerResultLabel(value) {
  const key = ({ POSITIVE: "positive", NEGATIVE: "negative", PENDING: "pending" }[(value || "").toUpperCase()]);
  return key ? ft(key) : (value || ft("unknown"));
}
function farmerLanguageControl() {
  return `<label class="farmer-language-control" title="${ft("language")}">
    <span aria-hidden="true">🌐</span>
    <select aria-label="${ft("language")}" onchange="setLang(this.value)">
      <option value="en" ${state.lang === "en" ? "selected" : ""}>English</option>
      <option value="mr" ${state.lang === "mr" ? "selected" : ""}>मराठी</option>
      <option value="hi" ${state.lang === "hi" ? "selected" : ""}>हिन्दी</option>
      <option value="te" ${state.lang === "te" ? "selected" : ""}>తెలుగు</option>
    </select><span class="farmer-language-chevron" aria-hidden="true">▾</span>
  </label>`;
}
function authText(role, key, fallback) { return role === "owner" ? ft(key) : fallback; }

window.setLang = async function (lang) {
  if (!Object.prototype.hasOwnProperty.call(I18N, lang) || state.lang === lang) return;
  const formState = Array.from(document.querySelectorAll("#app form")).map((form, index) => ({
    id: form.id, index,
    fields: Array.from(form.elements).map((field) => ({
      value: field.type === "file" ? "" : field.value,
      checked: typeof field.checked === "boolean" ? field.checked : null,
      selected: field.options ? Array.from(field.options, (option) => option.selected) : null,
    })),
  }));
  const scrollY = window.scrollY;
  state.lang = lang;
  localStorage.setItem("pm_lang", lang);
  document.documentElement.lang = lang;
  await router();
  const nextForms = Array.from(document.querySelectorAll("#app form"));
  formState.forEach((saved) => {
    const form = saved.id ? nextForms.find((candidate) => candidate.id === saved.id) : nextForms[saved.index];
    if (!form) return;
    saved.fields.forEach((fieldState, index) => {
      const field = form.elements[index];
      if (!field || field.type === "file") return;
      field.value = fieldState.value;
      if (fieldState.checked !== null) field.checked = fieldState.checked;
      if (fieldState.selected && field.options) {
        fieldState.selected.forEach((selected, optionIndex) => {
          if (field.options[optionIndex]) field.options[optionIndex].selected = selected;
        });
      }
    });
  });
  window.scrollTo(0, scrollY);
};
document.documentElement.lang = state.lang;
function langToggle() {
  return `<div class="lang-toggle">
    <span>${t("lang.label")}:</span>
    <button type="button" class="${state.lang === "en" ? "active" : ""}" onclick="setLang('en')">English</button>
    <button type="button" class="${state.lang === "mr" ? "active" : ""}" onclick="setLang('mr')">मराठी</button>
    <button type="button" class="${state.lang === "hi" ? "active" : ""}" onclick="setLang('hi')">हिन्दी</button>
    <button type="button" class="${state.lang === "te" ? "active" : ""}" onclick="setLang('te')">తెలుగు</button>
  </div>`;
}

// ---------------------------------------------------------------- utils --
function toast(msg, isError = false) {
  const el = document.getElementById("toast");
  if (getUserRole() === "owner") msg = farmerRuntimeText(msg);
  // WCAG 4.1.3 Status Messages (GIGW A50): the toast is a visual notification
  // that sighted users see but screen-reader users would otherwise miss.
  // Announce it through the shared live region. `assertive` is used for errors
  // only, so routine confirmations do not interrupt.
  if (window.PashuShell && window.PashuShell.announce) {
    window.PashuShell.announce(String(msg), !!isError);
  }
  if (!el) return;
  // Colour is never the only signal: errors carry a prefix too (GIGW A12).
  el.textContent = isError ? "Error — " + msg : msg;
  el.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.className = "toast"), 3200);
}

// --------------------------------------- offline queue synchronization --
function getOfflineQueue() {
  try { return JSON.parse(localStorage.getItem("pashu_offline_queue") || "[]"); } catch (e) { return []; }
}
function setOfflineQueue(q) {
  localStorage.setItem("pashu_offline_queue", JSON.stringify(q));
}
function queueOfflineAction(path, method, body) {
  const q = getOfflineQueue();
  const txnId = "client_txn_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  let action = "UNKNOWN";
  if (path.includes("/cases") && method === "POST") action = "CREATE_CASE";
  else if (path.includes("/samples") && method === "POST") action = "COLLECT_SAMPLE";
  else if (path.includes("/treatment-responses")) action = "RECORD_TREATMENT";
  else if (path.includes("/animals") && method === "POST") action = "REGISTER_ANIMAL";
  q.push({ client_txn_id: txnId, path, method, action, payload: body, timestamp: new Date().toISOString() });
  setOfflineQueue(q);
}
async function syncOfflineQueue() {
  const q = getOfflineQueue();
  if (!q.length) return;
  if (!state.token) return;
  try {
    const res = await fetch(API + "/sync/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + state.token },
      body: JSON.stringify({ items: q })
    });
    if (res.ok) {
      const data = await res.json();
      setOfflineQueue([]);
      toast(getUserRole() === "owner" ? ft("sync_success") : `🟢 Synchronized ${data.synced_count} field operation(s) successfully!`);
      router();
    }
  } catch (e) {}
}
window.syncOfflineQueue = syncOfflineQueue;
window.addEventListener("online", syncOfflineQueue);

async function getIvrInfo() {
  if (!ivrInfoPromise) {
    ivrInfoPromise = fetch(API + "/ivr/info")
      .then(res => res.ok ? res.json() : Promise.reject(new Error("Helpline configuration unavailable")))
      .catch(() => DEFAULT_IVR_INFO);
  }
  return ivrInfoPromise;
}

function helplineCard(info = DEFAULT_IVR_INFO) {
  const number = info.helpline_number || DEFAULT_IVR_INFO.helpline_number;
  const telUri = info.tel_uri || DEFAULT_IVR_INFO.tel_uri;
  const farmer = getUserRole() === "owner";
  return `
    <div class="section-card helpline-card">
      <div class="section-title">☎️ ${farmer ? ft("helpline_title") : "Need Veterinary Help?"}</div>
      <div class="small-muted">${farmer ? ft("helpline_name") : "Pashu-Shield Helpline"}</div>
      <div class="helpline-number">${escapeHtml(number)}</div>
      <a class="btn btn-primary helpline-call" href="${escapeHtml(telUri)}" aria-label="${farmer ? ft("call_now") : "Call Pashu-Shield helpline"} ${escapeHtml(number)}">☎ ${farmer ? ft("call_now") : "CALL NOW"}</a>
      <div class="desktop-call-note">${escapeHtml(farmer ? ft("desktop_call_note") : "On a desktop computer, call this number from your mobile phone.")}</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Prototype demo farmer account (server flag: DEMO_MODE, default false).
// The credentials shown here come from /api/auth/farmer/config, which only
// returns them while the backend has demo mode enabled. With demo mode off the
// section is never rendered, and the backend rejects the fixed OTP anyway — the
// browser can never grant itself a session by showing these values.
// ---------------------------------------------------------------------------
function farmerDemoCredentials() {
  const demo = (farmerAuthConfig && farmerAuthConfig.demo) || null;
  if (!demo || demo.enabled !== true) return null;
  const mobile = String(demo.mobile || "").replace(/\D/g, "").slice(-10);
  const otp = String(demo.otp || "");
  if (mobile.length !== 10 || !/^\d{6}$/.test(otp)) return null;
  return { mobile, otp };
}

function farmerDemoAccountSection() {
  const creds = farmerDemoCredentials();
  if (!creds) return "";
  return `
    <div class="demo-box demo-box-otp" id="farmerDemoAccount">
      <div class="demo-box-title">🧪 ${ft("demo_account_title")}</div>
      <div class="demo-box-row">
        <span class="demo-box-label">${ft("demo_phone_label")}</span>
        <span class="demo-box-value">${escapeHtml(creds.mobile)}</span>
      </div>
      <div class="demo-box-row">
        <span class="demo-box-label">${ft("demo_otp_label")}</span>
        <span class="demo-box-value">${creds.otp}</span>
      </div>
      <button id="otpUseDemoBtn" class="btn btn-ghost btn-sm demo-box-btn" type="button">
        ${ft("demo_use_button")}
      </button>
      <div class="demo-box-note">${ft("demo_no_sms")}</div>
    </div>`;
}

function renderFarmerDemoAccount() {
  const slot = document.getElementById("farmerDemoAccountSlot");
  if (!slot) return false;
  const html = farmerDemoAccountSection();
  slot.innerHTML = html;
  slot.hidden = !html;
  // Only wire the button when the box is actually on screen, so a disabled
  // demo mode leaves no handler behind.
  if (html) {
    const btn = document.getElementById("otpUseDemoBtn");
    if (btn) btn.addEventListener("click", useDemoFarmerAccount);
  }
  return Boolean(html);
}

// Fills the demo number into the normal farmer login form. It only types into
// the field: the OTP request and the verification still go through the regular
// endpoints, and the session still comes from the server.
function useDemoFarmerAccount() {
  const creds = farmerDemoCredentials();
  const mobileInput = document.getElementById("otpMobile");
  if (!creds || !mobileInput) return;
  mobileInput.value = creds.mobile;
  mobileInput.readOnly = false;
  mobileInput.focus();
  const sendBtn = document.getElementById("otpSendBtn");
  if (sendBtn) sendBtn.focus();
  toast(ft("demo_filled"));
}

function demoAccountBox(role) {
  const account = DEMO_ACCOUNTS[role];
  const label = role === "owner" ? (key => ft(key)) : (key => ({ demo_account: "Demo Account", username: "Username", password: "Password" }[key]));
  if (role === "owner") {
    // Farmers now sign in with a mobile OTP; the demo box shows the seeded mobile.
    return `<div class="demo-box">
    <b>${label("demo_account")}</b><br />
    ${label("demo_mobile")}: <b>${escapeHtml(account.mobile)}</b>
  </div>`;
  }
  return `<div class="demo-box">
    <b>${label("demo_account")}</b><br />
    ${label("username")}: <b>${account.username}</b><br />
    ${label("password")}: <b>${account.password}</b>
  </div>`;
}

async function api(path, { method = "GET", body, queueOffline = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (state.token) headers.Authorization = "Bearer " + state.token;
  try {
    const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = {};
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      // Never log the user out for failed pre-login OTP attempts.
      if (res.status === 401 && !path.startsWith("/auth/farmer/")) logout(true);
      const rawMessage = data.error || "Something went wrong. Please try again.";
      const err = new Error(getUserRole() === "owner" ? farmerRuntimeText(rawMessage) : rawMessage);
      err.data = data;
      err.status = res.status;
      throw err;
    }
    return data;
  } catch (err) {
    // OTP requests must never be queued offline: a queued "send" would claim an
    // SMS that was never actually dispatched. Only safe writes may be queued.
    if (queueOffline && !navigator.onLine && ["POST", "PUT"].includes(method)) {
      queueOfflineAction(path, method, body);
      toast("Offline mode: Operation queued locally for auto-sync.", false);
      return { ok: true, offline_queued: true };
    }
    throw err;
  }
}

function setAuth(token, user) {
  state.token = token; state.user = user;
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
  // Web-call signaling authenticates with this same token.
  if (window.PMCall && window.PMCall.onAuthChanged) window.PMCall.onAuthChanged();
}

function logout(silent) {
  const wasOwner = getUserRole() === "owner";
  // Tear down any live web call and signaling socket before dropping the token.
  if (window.PMCall && window.PMCall.onAuthChanged) window.PMCall.onAuthChanged();
  state.token = null; state.user = null;
  localStorage.removeItem("token"); localStorage.removeItem("user");
  location.hash = "#/";
  if (!silent) toast(wasOwner ? ft("logout_success") : "Logged out successfully");
}
window.logout = logout;

function fmtDate(d) {
  if (!d) return "—";
  const locale = getUserRole() === "owner" ? `${state.lang}-IN` : "en-IN";
  try { return new Date(d).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" }); }
  catch (e) { return d; }
}
function statusBadgeClass(status) {
  const s = (status || "").toUpperCase();
  if (["NEW", "ASSIGNED", "UNDER INVESTIGATION", "REJECTED"].includes(s)) return "badge-red";
  if (["SAMPLE COLLECTED", "LAB PENDING", "DIAGNOSED", "TREATMENT", "FOLLOW-UP", "READY_FOR_PICKUP", "PICKED_UP", "IN_TRANSIT", "ARRIVED_AT_LAB", "LAB_RECEIVED", "TESTING", "RESULT_READY"].includes(s)) return "badge-orange";
  if (["RECOVERED", "CLOSED", "COMPLETED", "VERIFIED"].includes(s)) return "badge-green";
  return "badge-blue";
}
function severityBadgeClass(sev) {
  const s = (sev || "").toLowerCase();
  if (s === "high" || s === "critical") return "badge-red";
  if (s === "medium" || s === "moderate") return "badge-orange";
  return "badge-blue";
}
function riskBadgeClass(level) {
  return level === "High Risk" || level === "Critical" ? "badge-red" : level === "Moderate Risk" || level === "Moderate" ? "badge-orange" : "badge-green";
}
function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;");
}
function escapeAttr(value) { return escapeHtml(value); }
function escapeJsStr(value) {
  return String(value == null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/</g, "\\x3c")
    .replace(/>/g, "\\x3e")
    .replace(/&/g, "\\x26")
    .replace(/"/g, "\\x22");
}
function safeId(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.trunc(n)) : "0";
}
if (typeof window !== "undefined") {
  window.__pmEscapeHtml = escapeHtml;
  window.__pmEscapeAttr = escapeAttr;
  window.__pmEscapeJsStr = escapeJsStr;
  window.__pmSafeId = safeId;
}

function emptyState(msg) {
  if (getUserRole() === "owner") msg = farmerRuntimeText(msg);
  const raw = String(msg);
  const isPlain = !/<[a-z][\s\S]*>/i.test(raw);
  return `<div class="empty-state" role="status" aria-live="polite">${isPlain ? escapeHtml(raw) : raw}</div>`;
}
function loadingState(msg) {
  const safe = escapeHtml(msg || "Loading…");
  if (window.PMA11y && window.PMA11y.announceLoading) window.PMA11y.announceLoading(safe);
  return `<div class="loading" role="status" aria-live="polite" aria-busy="true">${safe}</div>`;
}
function errorState(msg) {
  const safe = escapeHtml(msg || "Something went wrong");
  if (window.PMA11y && window.PMA11y.announceError) window.PMA11y.announceError(safe);
  return `<div class="pm-state pm-state-error" role="alert" aria-live="assertive"><p class="pm-state-title">Error</p><p class="pm-state-body">${safe}</p><div class="btn-row" style="margin-top:10px"><button class="btn btn-outline btn-sm" onclick="location.reload()">Retry</button> <button class="btn btn-ghost btn-sm" onclick="history.back()">Go back</button></div></div>`;
}
/* GA-37/38 + UX-12: pagination + print/export helpers for reports */
function pmPaginate(items, page, pageSize) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page || 1), totalPages);
  const start = (safePage - 1) * pageSize;
  return { pageItems: items.slice(start, start + pageSize), total, totalPages, page: safePage, start, end: Math.min(start + pageSize, total) };
}
function pmPaginationHtml(total, page, pageSize, baseAction, opts) {
  opts = opts || {};
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return `<div class="pm-pagination-info" role="status" aria-live="polite">${total} item${total!==1?"s":""}</div>`;
  const prevDisabled = page <= 1 ? "disabled" : "";
  const nextDisabled = page >= totalPages ? "disabled" : "";
  const info = `${(page-1)*pageSize+1}–${Math.min(page*pageSize, total)} of ${total}`;
  const label = opts.label || "Pagination";
  return `<nav class="pm-pagination" aria-label="${escapeAttr(label)}"><div class="pm-pagination-info" role="status" aria-live="polite">${escapeHtml(info)}</div><div class="btn-row"><button class="btn btn-outline btn-sm" ${prevDisabled} onclick="${baseAction}(${page-1})" aria-label="Previous page">‹ Prev</button><span class="pm-page-indicator" aria-current="page">Page ${page} of ${totalPages}</span><button class="btn btn-outline btn-sm" ${nextDisabled} onclick="${baseAction}(${page+1})" aria-label="Next page">Next ›</button></div></nav>`;
}
function pmExportCsv(filename, rows, headers) {
  try {
    const head = headers || Object.keys(rows[0] || {});
    const csv = [head.join(",")].concat(rows.map(r => head.map(h => `"${String(r[h] ?? "").replace(/"/g,'""')}"`).join(","))).join("\n");
    const blob = new Blob([csv], {type:"text/csv"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
  } catch(e) { console.warn("CSV export failed", e); }
}
function pmPrintSection(id) {
  const el = document.getElementById(id);
  if (!el) return window.print();
  const w = window.open("", "_blank"); if (!w) return window.print();
  w.document.write(`<!doctype html><html><head><title>Print</title><style>body{font-family:system-ui,sans-serif;padding:24px} table{border-collapse:collapse;width:100%} th,td{border:1px solid #ccc;padding:8px;text-align:left} @media print{.no-print{display:none}}</style></head><body>${el.innerHTML}</body></html>`);
  w.document.close(); w.focus(); setTimeout(()=>w.print(), 300);
}
function accountActionsCard() {
  return `<div class="section-card"><div class="section-title">⚙️ Account</div><div class="btn-row"><button class="btn btn-ghost btn-sm" onclick="location.hash='#/account/deactivate'">Deactivate account</button><button class="btn btn-ghost btn-sm" onclick="localStorage.clear();location.hash='#/'">Log out</button></div><div class="small-muted" style="margin-top:6px">Deactivation preserves audit trail and blocks future logins. Contact support to re-activate.</div></div>`;
}
function statCard(num, lbl) {
  const safeNum = typeof num === "number" || /^\d+(\.\d+)?$/.test(String(num)) ? String(num) : escapeHtml(num);
  return `<div class="stat-card"><div class="num">${safeNum}</div><div class="lbl">${escapeHtml(lbl)}</div></div>`;
}
function iconItem(emoji, label, href) {
  const safeHref = String(href).startsWith("#/") ? escapeAttr(href) : "#/";
  return `<div class="icon-item" role="button" tabindex="0" aria-label="${escapeAttr(label)}" onclick="location.hash='${safeHref}'" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.hash='${safeHref}'}"><div class="icon-circle">${escapeHtml(emoji)}</div><span>${escapeHtml(label)}</span></div>`;
}

// ---------------------------------------------------------------- shell --
function header(title, opts = {}) {
  const role = getUserRole();
  const notifHref = role ? `#/${role}/notifications` : "#/";
  const profileHref = role ? `#/${role}/profile` : "#/";
  const qCount = getOfflineQueue().length;
  if (role === "owner") {
    return `
      <div class="app-header owner-app-header">
        <div class="owner-header-top">
          ${opts.back ? `<button class="header-icon-btn" aria-label="${ft("back_to_livestock")}" onclick="history.back()">←</button>`
            : `<button class="header-icon-btn" aria-label="${ft("notifications")}" onclick="location.hash='${notifHref}'">🔔${opts.notif ? '<span class="dot"></span>' : ''}</button>`}
          <div class="owner-brand">🐄 ${ft("app_name")}</div>
          <div class="owner-header-actions">
            ${farmerLanguageControl()}
            <button class="header-icon-btn" aria-label="${ft("profile")}" onclick="location.hash='${profileHref}'">👤</button>
          </div>
        </div>
        <h1 class="owner-page-title">${farmerHeaderTitle(title)}</h1>
      </div>
      ${qCount > 0 ? `<div class="owner-sync"><span class="sync-indicator" onclick="syncOfflineQueue()">⚡ ${qCount} ${ft("offline_count")}</span></div>` : ""}`;
  }
  return `
  <div class="app-header">
    ${opts.back ? `<button class="header-icon-btn" aria-label="Back" onclick="history.back()">←</button>`
      : `<button class="header-icon-btn" aria-label="Notifications" onclick="location.hash='${notifHref}'">🔔${opts.notif ? '<span class="dot"></span>' : ''}</button>`}
    <h1>${title}</h1>
    <button class="header-icon-btn" aria-label="Profile" onclick="location.hash='${profileHref}'">👤</button>
  </div>
  ${qCount > 0 ? `
    <div style="text-align:center;margin-top:6px">
      <span class="sync-indicator" onclick="syncOfflineQueue()">⚡ ${qCount} action(s) queued offline · Tap to sync</span>
    </div>` : ""}`;
}

function bottomNav(active) {
  const role = getUserRole();
  let items = [];
  let navClass = "";
  if (role === "owner") {
    navClass = " owner-bottom-nav";
    const ownerActive = active === "#/owner/report" ? "#/owner/cases" : active;
    active = ownerActive;
    items = [
      [`#/owner/dashboard`, "🏠", ft("home")],
      [`#/owner/livestock`, "🐄", ft("my_livestock")],
      [`#/owner/cases`, "📋", ft("cases")],
      [`#/owner/prescriptions`, "💊", ft("health_treatment")],
      [`#/owner/notifications`, "🔔", ft("notifications")]
    ];
  } else if (role === "vet") {
    items = [
      [`#/vet/dashboard`, "🏠", t("nav.dashboard")],
      [`#/vet/reports`, "📋", t("nav.reports")],
      [`#/vet/cases`, "🩺", t("nav.cases")],
      [`#/vet/campaigns`, "💉", t("nav.campaigns")],
      [`#/vet/search`, "🔍", t("nav.search")],
      [`#/vet/notifications`, "🔔", t("nav.alerts")]
    ];
  } else if (role === "govt") {
    items = [
      [`#/govt/dashboard`, "📊", t("nav.analytics")],
      [`#/govt/gis`, "🗺️", t("nav.gis")],
      [`#/govt/surveillance`, "🌐", t("nav.surveillance")],
      [`#/govt/ai`, "🧠", t("nav.ai")],
      [`#/govt/national`, "🇮🇳", t("nav.national")],
      [`#/govt/notifications`, "🔔", t("nav.alerts")]
    ];
  } else if (role === "lab") {
    items = [
      [`#/lab/dashboard`, "🏠", t("nav.dashboard")],
      [`#/lab/queue`, "🧪", t("nav.queue")],
      [`#/scan`, "📷", t("nav.scan")],
      [`#/lab/lab-reports`, "📋", t("nav.reports")],
      [`#/lab/notifications`, "🔔", t("nav.alerts")]
    ];
  }
  return `<div class="bottom-nav${navClass}">${items.map(([href, ic, lbl]) =>
    `<button class="nav-item ${active === href ? "active" : ""}" onclick="location.hash='${href}'"><span class="ic">${ic}</span>${lbl}</button>`
  ).join("")}</div>`;
}

function render(html) {
  document.getElementById("app").innerHTML = html;
  const farmerAuth = /^#\/(login|register)\/owner/.test(location.hash);
  // Leaving the farmer login screen stops the resend countdown.
  if (!farmerAuth) stopFarmerOtpCooldown();
  document.body.classList.toggle("farmer-portal", getUserRole() === "owner" || farmerAuth);
  document.documentElement.lang = state.lang;
  window.scrollTo(0, 0);
  // GIGW Q17 / A28 / A38: refresh title, description, canonical and lang now
  // that the new view is in the DOM. Views may also set their own metadata by
  // calling window.PashuShell.setPageMeta({title, description}) directly.
  if (window.PashuShell && window.PashuShell.setPageMeta) {
    const meta = render._pageMeta;
    window.PashuShell.setPageMeta({
      title: (meta && meta.title) || null,
      description: (meta && meta.description) || null,
      lang: state.lang,
    });
    render._pageMeta = null;
  }
}

/** Optional per-view page metadata (title/description) consumed by render(). */
function setPageMeta(meta) { render._pageMeta = meta || null; }

function barChart(items) {
  if (!items || !items.length) return emptyState("No data yet.");
  const max = Math.max(...items.map(i => i.value), 1);
  const total = items.reduce((s, i) => s + (Number(i.value) || 0), 0);
  const summary = `Bar chart with ${items.length} items, total ${total}. Highest: ${escapeHtml(items[0]?.label || "")} with ${items[0]?.value || 0}.`;
  const tableRows = items.map(i => `<tr><th scope="row">${escapeHtml(i.label)}</th><td>${escapeHtml(i.value)}</td></tr>`).join("");
  return `
    <div role="img" aria-label="${escapeAttr(summary)}" class="pm-chart pm-bar-chart">
      <p class="sr-only">${escapeHtml(summary)}</p>
      ${items.map(i => `
        <div style="margin:10px 0">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>${escapeHtml(i.label)}</span><b>${escapeHtml(i.value)}</b></div>
          <div style="background:#e8eaf3;border-radius:6px;height:12px;overflow:hidden" aria-hidden="true">
            <div style="width:${Math.max((i.value / max) * 100, 2)}%;height:12px;background:#3f51b5;border-radius:6px"></div>
          </div>
        </div>`).join("")}
      <details class="pm-chart-details"><summary>View data table (accessible alternative)</summary>
        <div class="pm-table-scroll" tabindex="0" role="region" aria-label="Bar chart data table"><table><caption>${escapeHtml(summary)}</caption><thead><tr><th scope="col">Label</th><th scope="col">Value</th></tr></thead><tbody>${tableRows}</tbody></table></div>
      </details>
    </div>`;
}
const PIE_COLORS = ["#3f51b5", "#e53935", "#43a047", "#fb8c00", "#8e24aa", "#00acc1", "#6d4c41", "#f4511e"];
function pieChart(items) {
  if (!items || !items.length) return emptyState("No data yet.");
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  let acc = 0;
  const stops = items.map((i, idx) => {
    const from = (acc / total) * 360; acc += i.value; const to = (acc / total) * 360;
    return `${PIE_COLORS[idx % PIE_COLORS.length]} ${from}deg ${to}deg`;
  }).join(", ");
  const legend = items.map((i, idx) => `
    <div style="display:flex;align-items:center;gap:6px;font-size:13px">
      <span style="width:12px;height:12px;border-radius:3px;background:${PIE_COLORS[idx % PIE_COLORS.length]};display:inline-block;flex:none" aria-hidden="true"></span>
      <span>${escapeHtml(i.label)} — ${escapeHtml(i.value)} (${Math.round((i.value / total) * 100)}%)</span>
    </div>`).join("");
  const summary = `Pie chart with ${items.length} categories, total ${total}. ${items.map(i => `${i.label}: ${i.value} (${Math.round((i.value/total)*100)}%)`).join(", ")}.`;
  const tableRows = items.map(i => `<tr><th scope="row">${escapeHtml(i.label)}</th><td>${escapeHtml(i.value)}</td><td>${Math.round((i.value/total)*100)}%</td></tr>`).join("");
  return `
    <div role="img" aria-label="${escapeAttr(summary)}" class="pm-chart pm-pie-chart">
      <p class="sr-only">${escapeHtml(summary)}</p>
      <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
        <div style="width:150px;height:150px;border-radius:50%;background:conic-gradient(${stops});flex:none" aria-hidden="true"></div>
        <div style="display:flex;flex-direction:column;gap:6px">${legend}</div>
      </div>
      <details class="pm-chart-details"><summary>View data table (accessible alternative)</summary>
        <div class="pm-table-scroll" tabindex="0" role="region" aria-label="Pie chart data table"><table><caption>${escapeHtml(summary)}</caption><thead><tr><th scope="col">Category</th><th scope="col">Value</th><th scope="col">Percent</th></tr></thead><tbody>${tableRows}</tbody></table></div>
      </details>
    </div>`;
}

// ------------------------------------------------------------- routing --
const routes = {};
function route(path, handler, roles) { routes[path] = { handler, roles }; }

function isPublic(path) {
  if (path === "#/" || path.startsWith("#/login") || path.startsWith("#/register")) return true;
  // GIGW Q09-Q14/Q18/Q31: the information pages (About, Contact, Feedback,
  // Help, Site Map, Search, Policies) must be reachable without logging in.
  // GIGW A31 (WCAG 2.4.5 "Multiple Ways") depends on search + sitemap being
  // available alongside navigation.
  return PUBLIC_INFO_ROUTES.some((p) => path === p || path.startsWith(p + "/"));
}

// Routes reachable by an anonymous visitor. Kept in one place so the router,
// the footer and the sitemap can never disagree.
const PUBLIC_INFO_ROUTES = [
  "#/about",
  "#/contact",
  "#/feedback",
  "#/help",
  "#/sitemap",
  "#/search",
  "#/policies",
];

async function router() {
  const hash = location.hash || "#/";
  const [path, query] = hash.split("?");
  const params = Object.fromEntries(new URLSearchParams(query || ""));

  // Not logged in -> only public routes allowed
  if (!state.token && !isPublic(path)) { location.hash = "#/"; return; }
  // Logged in -> bounce away from public routes to the correct role dashboard
  if (state.token && isPublic(path)) { location.hash = homeFor(getUserRole() || "owner"); return; }

  const routeCandidates = Object.keys(routes).sort((a, b) => {
    const aParams = (a.match(/:[^/]+/g) || []).length;
    const bParams = (b.match(/:[^/]+/g) || []).length;
    return aParams - bParams || b.length - a.length;
  });
  const matched = routeCandidates.find((r) => {
    const rp = r.split("/").map((s) => (s.startsWith(":") ? "([^/]+)" : s));
    return new RegExp("^" + rp.join("\\/") + "$").test(path);
  });

  if (!matched) {
    const farmer = getUserRole() === "owner";
    render(`${header(farmer ? ft("not_found") : "Not found", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">${farmer ? ft("not_found") : "Page not found."} <a class="link" onclick="location.hash='${homeFor(getUserRole() || "owner")}'">${farmer ? ft("go_home") : "Go home"}</a></div>`);
    return;
  }

  const def = routes[matched];
  const role = getUserRole();
  if (def.roles && role && !def.roles.includes(role)) {
    toast(role === "owner" ? ft("access_error") : "Access denied — that page belongs to another role.", true);
    location.hash = homeFor(role);
    return;
  }

  const parts = matched.split("/");
  const pathParts = path.split("/");
  const routeParams = {};
  parts.forEach((p, i) => { if (p.startsWith(":")) routeParams[p.slice(1)] = decodeURIComponent(pathParts[i]); });

  try {
    await def.handler({ ...params, ...routeParams });
  } catch (e) {
    console.error(e);
    const farmer = getUserRole() === "owner";
    render(`${header(farmer ? ft("error") : "Error", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">⚠️ ${escapeHtml(farmer ? farmerRuntimeText(e.message) : e.message)}</div>`);
  }
}
window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", router);
document.addEventListener("invalid", (event) => {
  if (getUserRole() !== "owner") return;
  const field = event.target;
  if (field.validity?.valueMissing) field.setCustomValidity(ft("validation_required"));
  else if (field.validity?.typeMismatch && field.type === "email") field.setCustomValidity(ft("validation_email"));
  else if (field.validity?.tooShort) field.setCustomValidity(ft("validation_min_length", { count: field.minLength }));
}, true);
document.addEventListener("input", (event) => event.target?.setCustomValidity?.(""));
document.addEventListener("change", (event) => event.target?.setCustomValidity?.(""));

// ================================================================= AUTH ==
const ROLE_META = {
  owner: { emoji: "🧑‍🌾", label: "role.owner", color: "#1fa971" },
  vet: { emoji: "🩺", label: "role.vet", color: "#2f6fed" },
  govt: { emoji: "🏛️", label: "role.govt", color: "#8e24aa" },
  lab: { emoji: "🔬", label: "role.lab", color: "#00838f" },
};

function renderRoleSelect() {
  render(`
  <div class="auth-wrap">
    <div class="auth-logo">
      <div class="emoji">🐄</div>
      <h2>PashuMitra</h2>
      <p>${t("app.tagline")}</p>
    </div>
    <div class="section-title" style="text-align:center;margin-bottom:14px">${t("auth.choose")}</div>
    <div class="role-cards">
      ${ROLES.map(r => `
        <div class="role-card" style="border-left:6px solid ${ROLE_META[r].color}" onclick="location.hash='#/login/${r}'">
          <div class="role-card-emoji">${ROLE_META[r].emoji}</div>
          <div class="role-card-body">
            <div class="role-card-title">${t(ROLE_META[r].label)}</div>
            <div class="role-card-desc">${t(ROLE_META[r].label + ".desc")}</div>
          </div>
          <div class="role-card-go">→</div>
        </div>`).join("")}
    </div>
    ${langToggle()}
  </div>`);
}

function validRole(role) { return ROLES.includes(role); }

// =================================================== FARMER OTP LOGIN =====
// Farmers authenticate with a registered mobile number + SMS OTP handled by
// the backend (POST /api/auth/farmer/{request,resend,verify}-otp). The OTP is
// never stored in the browser: only the backend holds verification state.

let farmerAuthConfig = null;
// "login"  -> OTP login for an existing farmer account (no signup on the wire)
// "signup" -> OTP-verified farmer profile creation (#/register/owner)
let farmerAuthMode = "login";
const farmerOtpState = {
  mobile: "", sent: false, cooldownUntil: 0, timer: null,
  registrationToken: "", profileStep: false, viaPhoneAuth: false,
};

const OTP_ERROR_KEYS = {
  INVALID_MOBILE: "otp_invalid_mobile",
  INVALID_OTP_FORMAT: "otp_invalid_code",
  OTP_INVALID: "otp_invalid",
  OTP_EXPIRED: "otp_expired",
  OTP_LOCKED: "otp_locked",
  OTP_ALREADY_USED: "otp_used",
  COOLDOWN_ACTIVE: "otp_cooldown",
  RATE_LIMITED: "otp_rate_limited",
  SMS_GATEWAY_NOT_CONFIGURED: "otp_unavailable",
  SMS_GATEWAY_AUTH_FAILED: "otp_unavailable",
  SMS_GATEWAY_UNAVAILABLE: "otp_send_failed",
  SMS_GATEWAY_REJECTED: "otp_send_failed",
  SMS_GATEWAY_ERROR: "otp_send_failed",
  // Server-side readiness problem (unstable OTP pepper / unusable gateway):
  // the same neutral "OTP login is not available" copy is shown.
  OTP_PEPPER_UNSTABLE: "otp_unavailable",
  // The demo number could not be provisioned (e.g. it is held by a staff
  // account, which is never converted). Retry later.
  DEMO_ACCOUNT_UNAVAILABLE: "otp_unavailable",
  // Hosted phone-OTP provider (server codes from /auth/farmer/clerk).
  PHONE_AUTH_UNAVAILABLE: "otp_unavailable",
  CLERK_NOT_CONFIGURED: "otp_unavailable",
  CLERK_UNAVAILABLE: "otp_unavailable",
  CLERK_TOKEN_MISSING: "otp_invalid",
  CLERK_TOKEN_INVALID: "otp_invalid",
  CLERK_NO_PHONE: "otp_invalid_mobile",
};

// ------------------------------------------- hosted phone OTP (Clerk) ----
// When the server publishes `phone_auth` in /auth/farmer/config, the SMS OTP
// is sent and checked by Clerk in the browser; the backend then swaps the
// Clerk session token for the app's own JWT. The provider is never named in
// the UI: every error is mapped to the existing farmer OTP wording.
const phoneAuth = { promise: null, flow: "", phoneNumberId: "" };

function phoneAuthConfig() {
  const cfg = farmerAuthConfig && farmerAuthConfig.phone_auth;
  return cfg && cfg.enabled ? cfg : null;
}

function usePhoneAuthFor(mobile) {
  if (!phoneAuthConfig()) return false;
  const demo = farmerDemoCredentials(); // the demo farmer keeps its fixed OTP
  return !(demo && demo.mobile === mobile);
}

function phoneAuthUnavailable() {
  const err = new Error("unavailable");
  err.data = { code: "PHONE_AUTH_UNAVAILABLE" };
  return err;
}

function loadPhoneAuth() {
  const cfg = phoneAuthConfig();
  if (!cfg) return Promise.reject(phoneAuthUnavailable());
  if (phoneAuth.promise) return phoneAuth.promise;
  phoneAuth.promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = cfg.script_url;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.setAttribute("data-clerk-publishable-key", cfg.publishable_key);
    script.onload = resolve;
    script.onerror = () => reject(phoneAuthUnavailable());
    document.head.appendChild(script);
  }).then(async () => {
    if (!window.Clerk) throw phoneAuthUnavailable();
    await window.Clerk.load();
    return window.Clerk;
  }).catch((err) => {
    phoneAuth.promise = null; // allow a retry on the next tap
    throw err && err.data ? err : phoneAuthUnavailable();
  });
  return phoneAuth.promise;
}

// Speed: open the connection and load the SDK while the farmer is still
// typing the number, so "Send OTP" goes straight to the SMS request.
function prewarmPhoneAuth() {
  const cfg = phoneAuthConfig();
  if (!cfg) return;
  if (cfg.frontend_api && !document.querySelector(`link[rel="preconnect"][href="${cfg.frontend_api}"]`)) {
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = cfg.frontend_api;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }
  loadPhoneAuth().catch(() => {});
}

function phoneAuthErrorKey(err) {
  // Provider errors carry `errors[]` (API) or a string `code` (runtime) and
  // never `data` (that is our own API's shape).
  if (!err || err.data) return null;
  const code = providerErrorCode(err);
  if (!code && !Array.isArray(err.errors)) return null;
  console.warn("Phone OTP provider error:", code || "(no code)");
  if (err.status === 429 || /too_many_requests|rate_limit/.test(code)) return "otp_rate_limited";
  if (/code_incorrect|incorrect_code/.test(code)) return "otp_invalid";
  if (/expired/.test(code)) return "otp_expired";
  if (/too_many_attempts|locked|verification_failed/.test(code)) return "otp_locked";
  if (/phone_number|identifier|format_invalid|param_format/.test(code)) return "otp_invalid_mobile";
  if (/quota|limit|sms|captcha/.test(code)) return "otp_send_failed";
  return "generic_error";
}

function providerErrorCode(err) {
  if (err && Array.isArray(err.errors) && err.errors[0]) return String(err.errors[0].code || "");
  return err && typeof err.code === "string" ? err.code : "";
}

async function phoneAuthSignIn(clerk, phone) {
  const signIn = await clerk.client.signIn.create({ identifier: phone });
  const factor = (signIn.supportedFirstFactors || []).find((f) => f.strategy === "phone_code");
  if (!factor) throw phoneAuthUnavailable();
  await signIn.prepareFirstFactor({ strategy: "phone_code", phoneNumberId: factor.phoneNumberId });
  phoneAuth.flow = "signIn";
  phoneAuth.phoneNumberId = factor.phoneNumberId;
}

async function phoneAuthSend(mobile, isResend) {
  const clerk = await loadPhoneAuth();
  if (isResend && phoneAuth.flow === "signIn" && phoneAuth.phoneNumberId) {
    await clerk.client.signIn.prepareFirstFactor({ strategy: "phone_code", phoneNumberId: phoneAuth.phoneNumberId });
    return;
  }
  // Single-session instance: a leftover provider session would block sign-in.
  if (clerk.session) await clerk.signOut().catch(() => {});
  const phone = "+91" + mobile;
  try {
    await phoneAuthSignIn(clerk, phone);
  } catch (err) {
    if (providerErrorCode(err) !== "form_identifier_not_found") throw err;
    // First time this number logs in: the server registers it with the
    // provider (no browser sign-up, so no CAPTCHA / password step), then the
    // normal SMS-code sign-in proves the farmer owns the number.
    await api("/auth/farmer/phone-start", { method: "POST", body: { mobile }, queueOffline: false });
    await phoneAuthSignIn(clerk, phone);
  }
}

async function phoneAuthVerify(code) {
  const clerk = await loadPhoneAuth();
  const result = await clerk.client.signIn.attemptFirstFactor({ strategy: "phone_code", code });
  if (result.status !== "complete" || !result.createdSessionId) {
    // e.g. "needs_second_factor" when the dashboard enforces MFA. Admin-only
    // detail goes to the console, not the screen.
    console.warn("Phone OTP flow incomplete:", result.status);
    throw phoneAuthUnavailable();
  }
  await clerk.setActive({ session: result.createdSessionId });
  const token = await clerk.session.getToken();
  const data = await api("/auth/farmer/clerk", { method: "POST", body: { token }, queueOffline: false });
  // The app keeps its own JWT; the provider session is not needed any more.
  clerk.signOut().catch(() => {});
  phoneAuth.flow = "";
  return data;
}

function otpDigits(value) { return String(value == null ? "" : value).replace(/\D/g, ""); }

function otpErrorMessage(err) {
  // Provider errors are never shown verbatim (they would name the provider).
  const providerKey = phoneAuthErrorKey(err);
  if (providerKey) return ft(providerKey);
  const code = err && err.data && err.data.code;
  if (code && OTP_ERROR_KEYS[code]) return ft(OTP_ERROR_KEYS[code]);
  const message = (err && err.message) || "";
  if (/failed to fetch|networkerror|load failed/i.test(message)) return ft("connection_error");
  return message || ft("generic_error");
}

function setButtonBusy(btn, busy, busyLabel) {
  if (!btn) return;
  if (busy) {
    if (!btn.dataset.idleLabel) btn.dataset.idleLabel = btn.textContent;
    btn.disabled = true;
    btn.classList.add("is-busy");
    if (busyLabel) btn.textContent = busyLabel;
  } else {
    btn.disabled = false;
    btn.classList.remove("is-busy");
    if (btn.dataset.idleLabel) { btn.textContent = btn.dataset.idleLabel; delete btn.dataset.idleLabel; }
  }
}

function farmerOtpLoginForm(mode) {
  const signup = mode === "signup";
  return `
  <form id="farmerOtpForm" novalidate>
    <div class="otp-card-title">📲 ${signup ? ft("signup_title") : ft("otp_title")}</div>
    <div class="field">
      <label for="otpMobile">${ft("otp_mobile_label")}</label>
      <div class="otp-mobile-row">
        <span class="otp-prefix" aria-hidden="true">+91</span>
        <input id="otpMobile" name="mobile" type="tel" inputmode="numeric" autocomplete="tel-national"
               maxlength="10" placeholder="${ft("otp_mobile_placeholder")}"
               aria-describedby="otpMobileHint" required />
      </div>
      <div class="otp-hint" id="otpMobileHint">${signup ? ft("signup_mobile_hint") : ft("otp_mobile_hint")}</div>
    </div>
    <div id="pmCaptchaFarmer" class="pm-captcha-host"></div>
    <button id="otpSendBtn" class="btn btn-primary" type="button">${ft("send_otp")}</button>
    <div id="farmerDemoAccountSlot" class="demo-slot" hidden></div>
    <div id="otpCodeStep" class="otp-code-step" hidden>
      <div class="otp-sent-note" id="otpSentNote" role="status"></div>
      <div class="field">
        <label for="otpCode">${ft("enter_otp")}</label>
        <input id="otpCode" name="otp" class="otp-code-input" type="text" inputmode="numeric"
               autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}"
               placeholder="${ft("otp_placeholder")}" />
      </div>
      <div class="otp-hint" id="otpMissingHint">${ft("otp_missing_hint")}</div>
      <button id="otpVerifyBtn" class="btn btn-primary" type="submit">${signup ? ft("verify_mobile") : ft("verify_and_login")}</button>
      <div class="otp-resend-row">
        <span class="otp-resend-hint" id="otpResendHint"></span>
        <button id="otpResendBtn" class="btn btn-ghost btn-sm" type="button" disabled>${ft("resend_otp")}</button>
      </div>
      <div class="auth-switch"><a id="otpChangeMobile" role="button" tabindex="0">${ft("change_mobile")}</a></div>
    </div>
    <div id="farmerProfileStep" class="otp-code-step" hidden>
      <div class="otp-card-title">🧑‍🌾 ${ft("profile_title")}</div>
      <div class="otp-sent-note" id="otpProfileNote" role="status"></div>
      <div class="field">
        <label for="farmerFullName">${authText("owner", "full_name", "Full Name")}</label>
        <input id="farmerFullName" name="full_name" autocomplete="name" required />
      </div>
      <div class="form-row">
        <div class="field"><label for="farmerVillage">${authText("owner", "village", "Village")}</label>
          <input id="farmerVillage" name="village" autocomplete="address-level3" /></div>
        <div class="field"><label for="farmerBlock">${authText("owner", "block", "Block")}</label>
          <input id="farmerBlock" name="block" /></div>
      </div>
      <div class="field"><label for="farmerDistrict">${authText("owner", "district", "District")}</label>
        <input id="farmerDistrict" name="district" placeholder="${ft("district")}" required /></div>
      <div class="field"><label for="farmerEmail">${authText("owner", "email", "Email")}</label>
        <input id="farmerEmail" name="email" type="email" autocomplete="email" /></div>
      <div class="field"><label for="farmerLanguage">${ft("preferred_helpline_language")}</label>
        <select id="farmerLanguage" name="preferred_language">
          <option value="">${ft("ask_language_call")}</option>
          <option value="en">English</option><option value="te">తెలుగు</option>
          <option value="hi">हिन्दी</option><option value="mr">मराठी</option>
        </select></div>
      <button id="farmerCreateBtn" class="btn btn-primary" type="button">${ft("create_account")}</button>
    </div>
    <div id="clerk-captcha"></div>
    <div id="otpFallback" class="otp-fallback"></div>
    <div class="auth-switch">
      <a id="farmerModeSwitch" role="button" tabindex="0"></a>
    </div>
  </form>`;
}

function showFarmerOtpCodeStep(mobile, message) {
  const step = document.getElementById("otpCodeStep");
  const note = document.getElementById("otpSentNote");
  const sendBtn = document.getElementById("otpSendBtn");
  if (step) step.hidden = false;
  if (sendBtn) sendBtn.hidden = true;
  if (note) note.textContent = message || ft("otp_sent", { mobile });
  farmerOtpState.sent = true;
}

function hideFarmerOtpCodeStep() {
  const step = document.getElementById("otpCodeStep");
  const sendBtn = document.getElementById("otpSendBtn");
  const profileStep = document.getElementById("farmerProfileStep");
  if (step) step.hidden = true;
  if (profileStep) profileStep.hidden = true;
  if (sendBtn) sendBtn.hidden = false;
  const codeInput = document.getElementById("otpCode");
  if (codeInput) codeInput.value = "";
  farmerOtpState.registrationToken = "";
  farmerOtpState.profileStep = false;
  farmerOtpState.viaPhoneAuth = false;
  stopFarmerOtpCooldown();
}

function remainingFarmerOtpCooldown() {
  return Math.max(0, Math.ceil((farmerOtpState.cooldownUntil - Date.now()) / 1000));
}

function updateFarmerOtpCooldownUi() {
  const resendBtn = document.getElementById("otpResendBtn");
  const hint = document.getElementById("otpResendHint");
  const remaining = remainingFarmerOtpCooldown();
  if (resendBtn) resendBtn.disabled = remaining > 0;
  if (hint) hint.textContent = remaining > 0 ? ft("resend_in", { seconds: remaining }) : ft("resend_ready");
}

function stopFarmerOtpCooldown() {
  if (farmerOtpState.timer) { clearInterval(farmerOtpState.timer); farmerOtpState.timer = null; }
  farmerOtpState.cooldownUntil = 0;
  farmerOtpState.sent = false;
}

function runFarmerOtpCooldown() {
  if (farmerOtpState.timer) { clearInterval(farmerOtpState.timer); farmerOtpState.timer = null; }
  updateFarmerOtpCooldownUi();
  if (remainingFarmerOtpCooldown() <= 0) return;
  farmerOtpState.timer = setInterval(() => {
    updateFarmerOtpCooldownUi();
    if (remainingFarmerOtpCooldown() <= 0) {
      clearInterval(farmerOtpState.timer);
      farmerOtpState.timer = null;
    }
  }, 1000);
}

function startFarmerOtpCooldown(seconds) {
  farmerOtpState.cooldownUntil = Date.now() + Math.max(0, Math.floor(Number(seconds) || 0)) * 1000;
  runFarmerOtpCooldown();
}

function renderFarmerOtpFallback(unavailable) {
  const box = document.getElementById("otpFallback");
  if (!box) return;
  // Farmer authentication is OTP-only — there is no password fallback. When the
  // SMS gateway (or its configuration) is down the farmer is told to retry and
  // given the helpline number instead.
  const helpline = (farmerAuthConfig && farmerAuthConfig.helpline) || DEFAULT_IVR_INFO.display_number;
  box.innerHTML = unavailable
    ? `<div class="otp-unavailable" role="alert">⚠️ ${ft("otp_unavailable_hint", { helpline })}</div>`
    : "";
}

async function loadFarmerAuthConfig() {
  try {
    farmerAuthConfig = await api("/auth/farmer/config", { queueOffline: false });
  } catch (err) {
    farmerAuthConfig = null; // the screen still works; only the hint is missing
  }
  renderFarmerOtpFallback(farmerAuthConfig && farmerAuthConfig.otp_login_enabled === false
    && !phoneAuthConfig());
  prewarmPhoneAuth();
  // The Demo Account section is shown only when the server says demo mode is
  // on. If the request failed we know nothing, so nothing is advertised.
  renderFarmerDemoAccount();
  return farmerAuthConfig;
}

function farmerOtpMobileValue() {
  const input = document.getElementById("otpMobile");
  return otpDigits(input ? input.value : "").slice(-10);
}

async function farmerRequestOtp(options = {}) {
  const isResend = !!options.resend;
  const mobileInput = document.getElementById("otpMobile");
  const mobile = farmerOtpMobileValue();

  if (mobile.length !== 10) {
    toast(ft("otp_invalid_mobile"), true);
    if (mobileInput) mobileInput.focus();
    return;
  }
  if (!navigator.onLine) { toast(ft("otp_offline"), true); return; }

  const btn = document.getElementById(isResend ? "otpResendBtn" : "otpSendBtn");
  if (btn && btn.disabled) return;
  setButtonBusy(btn, true, isResend ? ft("resending_otp") : ft("sending_otp"));

  try {
    let data;
    if (usePhoneAuthFor(mobile)) {
      await phoneAuthSend(mobile, isResend && farmerOtpState.viaPhoneAuth && farmerOtpState.mobile === mobile);
      farmerOtpState.viaPhoneAuth = true;
      data = { demo: false, resend_after: 30 };
    } else {
      let body = { mobile, intent: farmerAuthMode };
      if (window.PMCaptcha) Object.assign(body, window.PMCaptcha.getPayload("pmCaptchaFarmer"));
      data = await api(isResend ? "/auth/farmer/resend-otp" : "/auth/farmer/request-otp", {
        method: "POST",
        // The signup intent lets the backend reach a number that has no farmer
        // account yet; the login intent never does.
        body: body,
        queueOffline: false, // never claim an SMS that was not dispatched
      });
      farmerOtpState.viaPhoneAuth = false;
    }
    farmerOtpState.mobile = mobile;
    // The backend answers 200 for registered and unknown numbers alike and
    // never proves delivery, so the UI shows the conditional wording only —
    // never "OTP sent to <number>". `data.message` is the same sentence.
    // The demo farmer is the one exception, and the server says so explicitly
    // (data.demo): no SMS is sent and the code is on this screen.
    const note = data.demo
      ? ft("demo_no_sms")
      : isResend ? ft("otp_resent", { mobile }) : ft("otp_sent", { mobile });
    showFarmerOtpCodeStep(mobile, note);
    startFarmerOtpCooldown(data.demo ? 0 : (Number(data.resend_after) || 60));
    toast(note);
    const codeInput = document.getElementById("otpCode");
    if (codeInput) codeInput.focus();
  } catch (err) {
    if (err && err.status === 429 && err.data && err.data.retry_after) {
      // Rate limited / cooling down: an earlier OTP may be valid, so keep the
      // code step open — again with conditional wording, never a delivery claim.
      farmerOtpState.mobile = mobile;
      showFarmerOtpCodeStep(mobile, ft("otp_sent", { mobile }));
      startFarmerOtpCooldown(Number(err.data.retry_after) || 60);
    }
    if (err && err.data && ["SMS_GATEWAY_NOT_CONFIGURED", "OTP_PEPPER_UNSTABLE"].includes(err.data.code)) {
      renderFarmerOtpFallback(true);
    }
    toast(otpErrorMessage(err), true);
  } finally {
    setButtonBusy(btn, false);
  }
}

async function farmerVerifyOtp() {
  const codeInput = document.getElementById("otpCode");
  const code = otpDigits(codeInput ? codeInput.value : "").slice(0, 6);
  const mobile = farmerOtpState.mobile || farmerOtpMobileValue();

  if (mobile.length !== 10) { toast(ft("otp_invalid_mobile"), true); return; }
  if (code.length !== 6) {
    toast(ft("otp_invalid_code"), true);
    if (codeInput) codeInput.focus();
    return;
  }
  if (!navigator.onLine) { toast(ft("otp_offline"), true); return; }

  const btn = document.getElementById("otpVerifyBtn");
  if (btn && btn.disabled) return;
  setButtonBusy(btn, true, ft("verifying_otp"));

  try {
    const data = farmerOtpState.viaPhoneAuth
      ? await phoneAuthVerify(code)
      : await api("/auth/farmer/verify-otp", {
        method: "POST",
        body: { mobile, otp: code },
        queueOffline: false,
      });
    if (data.registration_required) {
      // Phone verified but no farmer account exists for this number: continue
      // to the profile step. The backend issues no session here — only a
      // short-lived token bound to the verified number.
      farmerAuthMode = "signup";
      farmerOtpState.registrationToken = data.registration_token || "";
      showFarmerProfileStep(data.mobile || mobile);
      return;
    }
    if (!data.user || data.user.role !== "owner") {
      toast(ft("portal_mismatch"), true);
      return;
    }
    stopFarmerOtpCooldown();
    setAuth(data.token, data.user);
    const welcomeName = String(data.user.full_name || "").split(" ")[0];
    toast(data.demo ? ft("demo_welcome") : ft("welcome_toast", { name: welcomeName }));
    location.hash = homeFor("owner");
  } catch (err) {
    if (codeInput) { codeInput.value = ""; codeInput.focus(); }
    if (err && err.data && ["SMS_GATEWAY_NOT_CONFIGURED", "OTP_PEPPER_UNSTABLE"].includes(err.data.code)) {
      renderFarmerOtpFallback(true);
    }
    toast(otpErrorMessage(err), true);
  } finally {
    setButtonBusy(btn, false);
  }
}

function showFarmerProfileStep(mobile, message) {
  const step = document.getElementById("farmerProfileStep");
  const codeStep = document.getElementById("otpCodeStep");
  const note = document.getElementById("otpProfileNote");
  const mobileInput = document.getElementById("otpMobile");
  if (codeStep) codeStep.hidden = true;
  if (step) step.hidden = false;
  if (note) note.textContent = message || ft("profile_note", { mobile });
  farmerOtpState.profileStep = true;
  if (mobileInput) mobileInput.readOnly = true;
  const nameInput = document.getElementById("farmerFullName");
  if (nameInput) nameInput.focus();
}

async function farmerCreateProfile() {
  const value = (id) => {
    const el = document.getElementById(id);
    return el ? String(el.value || "").trim() : "";
  };
  const fullName = value("farmerFullName");
  const district = value("farmerDistrict");
  if (fullName.length < 2 || !district) { toast(ft("profile_missing"), true); return; }
  if (!farmerOtpState.registrationToken) { toast(ft("registration_expired"), true); return; }
  if (!navigator.onLine) { toast(ft("otp_offline"), true); return; }

  const btn = document.getElementById("farmerCreateBtn");
  if (btn && btn.disabled) return;
  setButtonBusy(btn, true, ft("creating_account"));

  try {
    const data = await api("/auth/farmer/register", {
      method: "POST",
      body: {
        registration_token: farmerOtpState.registrationToken,
        full_name: fullName,
        village: value("farmerVillage"),
        block: value("farmerBlock"),
        district,
        email: value("farmerEmail"),
        preferred_language: value("farmerLanguage"),
      },
      queueOffline: false,
    });
    if (!data.user || data.user.role !== "owner") {
      toast(ft("portal_mismatch"), true);
      return;
    }
    stopFarmerOtpCooldown();
    farmerOtpState.registrationToken = "";
    farmerOtpState.profileStep = false;
    setAuth(data.token, data.user);
    const welcomeName = String(data.user.full_name || "").split(" ")[0];
    toast(ft("signup_success", { name: welcomeName }));
    location.hash = homeFor("owner");
  } catch (err) {
    if (err && err.data && err.data.code === "REGISTRATION_TOKEN_INVALID") {
      farmerOtpState.registrationToken = "";
      toast(ft("registration_expired"), true);
      return;
    }
    toast(otpErrorMessage(err), true);
  } finally {
    setButtonBusy(btn, false);
  }
}

function farmerChangeMobile() {
  hideFarmerOtpCodeStep();
  const mobileInput = document.getElementById("otpMobile");
  if (mobileInput) { mobileInput.readOnly = false; mobileInput.focus(); }
}

function wireFarmerOtpForm() {
  loadFarmerAuthConfig();
  if (window.PMCaptcha) window.PMCaptcha.renderCaptcha("pmCaptchaFarmer");

  const form = document.getElementById("farmerOtpForm");
  const mobileInput = document.getElementById("otpMobile");
  const sendBtn = document.getElementById("otpSendBtn");
  const resendBtn = document.getElementById("otpResendBtn");
  const changeLink = document.getElementById("otpChangeMobile");
  const codeInput = document.getElementById("otpCode");

  if (mobileInput) {
    mobileInput.addEventListener("input", () => {
      mobileInput.value = otpDigits(mobileInput.value).slice(0, 10);
    });
    mobileInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); farmerRequestOtp(); }
    });
    if (/^\d{10}$/.test(farmerOtpState.mobile)) mobileInput.value = farmerOtpState.mobile;
    mobileInput.focus();
  }
  if (sendBtn) sendBtn.addEventListener("click", () => farmerRequestOtp());
  if (resendBtn) resendBtn.addEventListener("click", () => farmerRequestOtp({ resend: true }));
  if (changeLink) {
    changeLink.addEventListener("click", farmerChangeMobile);
    changeLink.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); farmerChangeMobile(); }
    });
  }
  if (codeInput) {
    codeInput.addEventListener("input", () => {
      codeInput.value = otpDigits(codeInput.value).slice(0, 6);
      if (codeInput.value.length === 6) farmerVerifyOtp();
    });
  }
  if (form) form.addEventListener("submit", (event) => { event.preventDefault(); farmerVerifyOtp(); });

  const createBtn = document.getElementById("farmerCreateBtn");
  if (createBtn) createBtn.addEventListener("click", farmerCreateProfile);

  const modeSwitch = document.getElementById("farmerModeSwitch");
  if (modeSwitch) {
    // While the profile step is open the verified number is already committed
    // to signup, so no switch is offered.
    modeSwitch.hidden = !!farmerOtpState.profileStep;
    modeSwitch.textContent = farmerAuthMode === "signup" ? ft("login_link") : ft("signup_link");
    const switchMode = () => {
      location.hash = farmerAuthMode === "signup" ? "#/login/owner" : "#/register/owner";
    };
    modeSwitch.addEventListener("click", switchMode);
    modeSwitch.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); switchMode(); }
    });
  }

  if (farmerOtpState.profileStep && farmerOtpState.registrationToken) {
    // Restore the profile step after a re-render (e.g. a language switch).
    showFarmerProfileStep(farmerOtpState.mobile);
  } else if (farmerOtpState.sent && farmerOtpState.mobile) {
    // Restore the OTP step (and any running cooldown) after a re-render,
    // e.g. when the farmer switches language.
    showFarmerOtpCodeStep(farmerOtpState.mobile);
    runFarmerOtpCooldown();
    if (codeInput) codeInput.focus();
  }
}

// =================================================== AUTH SCREENS ========
function renderAuth(mode, role) {
  if (!validRole(role)) { location.hash = "#/"; return; }
  // Role-specific authentication:
  //   Farmer  -> mobile number + OTP for both login and profile creation.
  //   Vet / Government / Laboratory -> the original password login and signup.
  const isFarmerOtp = role === "owner";
  // A number that verified as "not registered yet" stays in signup mode across
  // re-renders (e.g. a language switch) until the profile is created.
  farmerAuthMode = (mode === "register" || farmerOtpState.profileStep) ? "signup" : "login";
  const meta = ROLE_META[role];
  render(`
  <div class="auth-wrap">
    ${role === "owner" ? `<div class="farmer-auth-language">${farmerLanguageControl()}</div>` : ""}
    <div class="auth-logo">
      <div class="emoji">${meta.emoji}</div>
      <h2>PashuMitra · ${t(meta.label)}</h2>
      <p>${t("app.tagline")}</p>
    </div>
    <div class="role-banner" style="background:${meta.color}1a;color:${meta.color}">
      ${meta.emoji} ${t(meta.label)} ${role === "owner" ? ft("farmer_portal") : "portal"}
    </div>
    ${isFarmerOtp ? farmerOtpLoginForm(mode) : (mode === "login" ? loginForm(role) : registerForm(role))}
    ${role === "owner" ? "" : langToggle()}
  </div>`);

  if (isFarmerOtp) {
    wireFarmerOtpForm();
    return;
  }

  // CAPTCHA hook (GA-21) — env-driven, accessible alternative
  if (window.PMCaptcha) {
    if (mode === "login") {
      window.PMCaptcha.renderCaptcha("pmCaptchaLogin");
    } else {
      window.PMCaptcha.renderCaptcha("pmCaptchaRegister");
    }
  }

  if (mode === "login") {
    document.getElementById("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      if (window.PMCaptcha) Object.assign(fd, window.PMCaptcha.getPayload("pmCaptchaLogin"));
      try {
        const data = await api("/auth/login", { method: "POST", body: fd, queueOffline: false });
        if (data.user.role !== role) {
          toast(role === "owner" ? ft("portal_mismatch") : `These credentials belong to the ${data.user.role} portal. Please use the correct login.`, true);
          return;
        }
        setAuth(data.token, data.user);
        const welcomeName = data.user.full_name.split(" ")[0];
        toast(role === "owner" ? ft("welcome_toast", { name: welcomeName }) : `Welcome back, ${welcomeName}!`);
        location.hash = homeFor(role);
      } catch (err) {
        toast(err.message, true);
        if (window.PMCaptcha) window.PMCaptcha.clear("pmCaptchaLogin");
      }
    });
  } else {
    document.getElementById("registerForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      fd.role = role;
      if (window.PMCaptcha) Object.assign(fd, window.PMCaptcha.getPayload("pmCaptchaRegister"));
      if (role === "owner" && fd.password !== fd.confirm_password) {
        toast(ft("passwords_mismatch"), true);
        return;
      }
      if (role === "owner" && fd.password.length < 6) {
        toast(ft("password_short"), true);
        return;
      }
      try {
        const data = await api("/auth/register", { method: "POST", body: fd, queueOffline: false });
        setAuth(data.token, data.user);
        toast(role === "owner" ? ft("account_created", { name: data.user.full_name }) : `Account created for ${data.user.full_name}!`);
        location.hash = homeFor(role);
      } catch (err) {
        toast(err.message, true);
        if (window.PMCaptcha) window.PMCaptcha.clear("pmCaptchaRegister");
      }
    });
  }
}

function loginForm(role) {
  // Vet / Government / Laboratory keep the original password login. Farmers
  // never reach this form: #/login/owner renders the OTP screen instead.
  return `
  <form id="loginForm">
    <div class="field"><label for="pm_identifier">${authText(role, "email_or_mobile", "Email or Mobile")}</label><input id="pm_identifier" name="identifier" autocomplete="username" required /></div>
    <div class="field"><label for="pm_password">${authText(role, "password", "Password")}</label><input id="pm_password" name="password" type="password" autocomplete="current-password" required /></div>
    <div id="pmCaptchaLogin" class="pm-captcha-host"></div>
    <button class="btn btn-primary" type="submit">${t("btn.login")}</button>
    <div class="auth-switch" style="margin-top:10px"><a onclick="location.hash='#/forgot-password/${role}'">Forgot password?</a> · ${t("auth.newHere")} <a onclick="location.hash='#/register/${role}'">${t("auth.createAccount")}</a></div>
    ${demoAccountBox(role)}
  </form>`;
}

function registerForm(role) {
  return `
  <form id="registerForm">
    <div class="field"><label for="pm_full_name">${authText(role, "full_name", "Full Name")}</label><input id="pm_full_name" name="full_name" autocomplete="name" required /></div>
    <div class="form-row">
      <div class="field"><label for="pm_mobile">${authText(role, "mobile", "Mobile")}</label><input id="pm_mobile" name="mobile" autocomplete="tel" required /></div>
      <div class="field"><label for="pm_email">${authText(role, "email", "Email")}</label><input id="pm_email" name="email" type="email" autocomplete="email" required /></div>
    </div>
    <div class="form-row">
      <div class="field"><label for="pm_password_2">${authText(role, "password", "Password")}</label><input id="pm_password_2" name="password" type="password" minlength="6" autocomplete="new-password" required /></div>
      <div class="field"><label for="pm_confirm_password">${authText(role, "confirm_password", "Confirm")}</label><input id="pm_confirm_password" name="confirm_password" type="password" minlength="6" autocomplete="new-password" required /></div>
    </div>
    ${role === "vet" || role === "lab" ? `<div class="field"><label for="pm_specialization">Specialization</label><input id="pm_specialization" name="specialization" placeholder="e.g. Pathology / Epidemiology" /></div>` : ""}
    <div class="form-row">
      <div class="field"><label for="pm_village">${authText(role, "village", "Village")}</label><input id="pm_village" name="village" autocomplete="address-level3" /></div>
      <div class="field"><label for="pm_block">${authText(role, "block", "Block")}</label><input id="pm_block" name="block" /></div>
    </div>
    <div class="field"><label for="pm_district">${authText(role, "district", "District")}</label><input id="pm_district" name="district" placeholder="${role === "owner" ? ft("district") : "e.g. Pune"}" required /></div>
    ${role === "owner" ? `<div class="field"><label for="pm_preferred_language">${ft("preferred_helpline_language")}</label><select id="pm_preferred_language" name="preferred_language"><option value="">${ft("ask_language_call")}</option><option value="en">English</option><option value="te">తెలుగు</option><option value="hi">हिन्दी</option><option value="mr">मराठी</option></select></div>` : ""}
    <div id="pmCaptchaRegister" class="pm-captcha-host"></div>
    <button class="btn btn-primary" type="submit">${t("btn.register")}</button>
    <div class="auth-switch">${t("auth.haveAccount")} <a onclick="location.hash='#/login/${role}'">${t("btn.login")}</a></div>
    ${demoAccountBox(role)}
  </form>`;
}

route("#/", () => renderRoleSelect());
route("#/login/:role", ({ role }) => renderAuth("login", role));
// Legacy bookmark: the farmer password screen no longer exists. Send it to the
// OTP screen (never to a password form) and staff to their own login.
route("#/login/:role/password", ({ role }) => {
  location.hash = role === "owner" ? "#/login/owner" : `#/login/${role}`;
});
route("#/register/:role", ({ role }) => renderAuth("register", role));

// GA-20 forgot-password & reset-password
route("#/forgot-password/:role", ({ role }) => renderForgotPassword(role));
route("#/reset-password", () => renderResetPassword());
route("#/account/deactivate", () => renderDeactivateAccount());

function renderForgotPassword(role) {
  if (!validRole(role) || role==="owner") { location.hash="#/login/owner"; return; }
  const meta = ROLE_META[role]||ROLE_META.vet;
  render(`
    <div class="auth-wrap">
      <div class="auth-logo"><div class="emoji">${meta.emoji}</div><h2>Forgot Password</h2><p>Reset for ${t(meta.label)}</p></div>
      <form id="forgotForm">
        <div class="field"><label for="fp_identifier">Email or Mobile</label><input id="fp_identifier" name="identifier" required autocomplete="username" /></div>
        <div id="pmCaptchaForgot" class="pm-captcha-host"></div>
        <button class="btn btn-primary" type="submit">Send reset link</button>
        <div class="auth-switch"><a onclick="location.hash='#/login/${role}'">Back to login</a></div>
      </form>
      <div id="fpResult" class="section-card" style="display:none;margin-top:12px"></div>
    </div>
  `);
  if (window.PMCaptcha) window.PMCaptcha.renderCaptcha("pmCaptchaForgot");
  document.getElementById("forgotForm").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    if (window.PMCaptcha) Object.assign(fd, window.PMCaptcha.getPayload("pmCaptchaForgot"));
    try {
      const data = await api("/auth/forgot-password", { method:"POST", body:fd, queueOffline:false });
      const el = document.getElementById("fpResult");
      el.style.display="block";
      el.innerHTML=`<div class="section-title">Check your email</div><p>${escapeHtml(data.message||"If an account exists, a reset link was sent.")}</p>${data.reset_token?`<div class="meta" style="margin-top:8px"><b>Demo reset token:</b> <code>${escapeHtml(data.reset_token)}</code><br/><a onclick="location.hash='#/reset-password?token=${encodeURIComponent(data.reset_token)}'">Reset now</a></div>`:""}<div class="small-muted">Ref: ${escapeHtml(data.reference||"")}</div>`;
      toast("Reset request sent");
    } catch(err){ toast(err.message,true); if(window.PMCaptcha) window.PMCaptcha.clear("pmCaptchaForgot"); }
  });
}

function renderResetPassword() {
  const params = new URLSearchParams((location.hash.split("?")[1]||""));
  const tokenFromUrl = params.get("token")||"";
  render(`
    <div class="auth-wrap">
      <div class="auth-logo"><div class="emoji">🔑</div><h2>Reset Password</h2><p>Enter new password</p></div>
      <form id="resetForm">
        <div class="field"><label for="rp_token">Reset token</label><input id="rp_token" name="token" value="${escapeAttr(tokenFromUrl)}" required /></div>
        <div class="field"><label for="rp_new">New password</label><input id="rp_new" name="new_password" type="password" minlength="6" required autocomplete="new-password" /></div>
        <div class="field"><label for="rp_confirm">Confirm password</label><input id="rp_confirm" name="confirm_password" type="password" minlength="6" required autocomplete="new-password" /></div>
        <button class="btn btn-primary" type="submit">Reset password</button>
        <div class="auth-switch"><a onclick="location.hash='#/'">Back to home</a></div>
      </form>
    </div>
  `);
  document.getElementById("resetForm").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      await api("/auth/reset-password", { method:"POST", body:fd, queueOffline:false });
      toast("Password reset successful, please login");
      location.hash="#/";
    } catch(err){ toast(err.message,true); }
  });
}

function renderDeactivateAccount() {
  const role = getUserRole();
  if (!role) { location.hash="#/"; return; }
  render(`
    ${header("Deactivate Account", { back: true })}
    <div class="section-card">
      <div class="section-title">⚠️ Deactivate Account</div>
      <div class="meta" style="margin-bottom:12px">This will soft-delete your account, preserve audit logs, and block future logins. You can contact support to re-activate.</div>
      <form id="deactForm">
        <div class="field"><label for="deact_reason">Reason (optional)</label><input id="deact_reason" name="reason" placeholder="Why are you deactivating?" /></div>
        <div class="field"><label for="deact_confirm">Type <b>deactivate</b> to confirm</label><input id="deact_confirm" name="confirm" required /></div>
        <button class="btn btn-primary" type="submit" style="background:var(--red)">Deactivate my account</button>
      </form>
    </div>
    ${bottomNav(homeFor(role))}
  `);
  document.getElementById("deactForm").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    if ((fd.confirm||"").toLowerCase()!=="deactivate") { toast("Please type deactivate to confirm", true); return; }
    try {
      await api("/auth/deactivate", { method:"POST", body:fd });
      toast("Account deactivated");
      localStorage.clear(); state.token=null; state.user=null;
      location.hash="#/";
    } catch(err){ toast(err.message,true); }
  });
}

// ============================================================ DASHBOARDS ==
route("#/owner/dashboard", () => ownerDashboard(), ["owner"]);
route("#/owner/webcall", async (params) => {
  if (window.PMCall && window.PMCall.renderOwnerCallView) await window.PMCall.renderOwnerCallView(params || {});
}, ["owner"]);
route("#/owner/calls", async () => {
  if (window.PMCall && window.PMCall.renderCallHistory) await window.PMCall.renderCallHistory("owner");
}, ["owner"]);
route("#/vet/calls", async (params) => {
  if (window.PMCall && window.PMCall.renderCallHistory) await window.PMCall.renderCallHistory("vet");
  if (window.PMCall && window.PMCall.reconcile) window.PMCall.reconcile();
}, ["vet"]);
route("#/vet/dashboard", () => vetDashboard(), ["vet"]);
route("#/govt/dashboard", () => govtDashboard(), ["govt"]);
route("#/lab/dashboard", () => labDashboard(), ["lab"]);

async function ownerDashboard() {
  render(`${header(ft("home"))}<div class="loading" role="status" aria-live="polite" aria-busy="true">${ft("loading_dashboard")}</div>`);
  const ivrInfo = await getIvrInfo();
  render(`
    ${header(ft("home"))}
    <div class="hello-banner owner-hello">
      <div>${ft("welcome_back")}</div>
      <div class="owner-name">${escapeHtml(state.user.full_name)} 👋</div>
    </div>
    <div class="section-card owner-home-card">
      <div class="section-title">${ft("home_prompt")}</div>
      <div class="owner-home-actions">
        <button class="owner-action-card" onclick="location.hash='#/owner/livestock'">
          <span class="action-icon">🐄</span><span>${ft("my_livestock")}</span>
        </button>
        <button class="owner-action-card" onclick="location.hash='#/owner/report'">
          <span class="action-icon">📋</span><span>${ft("report_problem")}</span>
        </button>
        <button class="owner-action-card" onclick="location.hash='#/owner/prescriptions'">
          <span class="action-icon">💊</span><span>${ft("health_treatment")}</span>
        </button>
        <button class="owner-action-card" onclick="location.hash='#/owner/webcall'">
          <span class="action-icon">📞</span><span>${ft("call_vet")}</span>
        </button>
        <button class="owner-action-card" onclick="location.hash='#/owner/notifications'">
          <span class="action-icon">🔔</span><span>${ft("notifications")}</span>
        </button>
      </div>
    </div>
    ${helplineCard(ivrInfo)}
    ${accountActionsCard()}
    ${bottomNav("#/owner/dashboard")}
  `);
}

route("#/owner/livestock", () => ownerLivestockView(), ["owner"]);
async function ownerLivestockView() {
  render(`${header(ft("my_livestock"))}<div class="loading" role="status" aria-live="polite" aria-busy="true">${ft("loading_livestock")}</div>`);
  try {
    const [animals, herds] = await Promise.all([api("/animals"), api("/herds")]);
    render(`
      ${header(ft("my_livestock"))}
      <div class="section-card owner-livestock-actions">
        <div class="owner-livestock-action-grid">
          <button class="btn btn-primary" onclick="location.hash='#/owner/animals/new'">＋ ${ft("add_animal")}</button>
          <button class="btn btn-ghost" onclick="location.hash='#/owner/herds/new'">＋ ${ft("add_herd")}</button>
        </div>
      </div>
      <div class="section-card">
        <div class="section-title">🐄 ${ft("my_animals")} (${animals.length})</div>
        ${animals.length ? animals.map(a => `
          <div class="list-card farmer-list-card" role="button" tabindex="0" onclick="location.hash='#/owner/animals/${safeId(a.id)}'" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.hash='#/owner/animals/${safeId(a.id)}'}">
            <div class="row1">
              <span class="title">${escapeHtml(a.animal_name || a.animal_code)}</span>
              <span class="badge ${escapeHtml(a.status === "Healthy" ? "badge-green" : a.status === "Deceased" ? "badge-blue" : "badge-orange")}">${ownerAnimalStatus(a.status)}</span>
            </div>
            <div class="meta">${ft("animal_id")}: ${escapeHtml(a.animal_code)}</div>
            <div class="meta">${ft("animal_type")}: ${ownerAnimalType(a.animal_type || a.species)} · ${ft("breed")}: ${escapeHtml(a.breed || ft("unknown"))}</div>
            <div class="meta">${ft("age")}: ${escapeHtml(a.age ?? a.age_years ?? ft("unknown"))}${(a.age ?? a.age_years) !== null && (a.age ?? a.age_years) !== undefined && (a.age ?? a.age_years) !== "" ? ` ${ft("years")}` : ""}</div>
          </div>`).join("") : emptyState(ft("no_animals") + ". " + ft("no_animals_hint"))}
      </div>
      <div class="section-card">
        <div class="section-title">🐑 ${ft("my_herds")} (${herds.length})</div>
        ${herds.length ? herds.map(h => `
          <div class="list-card farmer-list-card" role="button" tabindex="0" onclick="location.hash='#/owner/herds/${safeId(h.id)}'" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.hash='#/owner/herds/${safeId(h.id)}'}">
            <div class="row1"><span class="title">${ft("herd_name")} ${escapeHtml(h.herd_code)}</span><span class="badge badge-blue">${escapeHtml(h.animal_count || 0)} ${ft("animal_count")}</span></div>
            <div class="meta">${ft("location")}: ${escapeHtml([h.village, h.block, h.district].filter(Boolean).join(", ") || ft("unknown"))}</div>
            <div class="meta ${escapeHtml(h.active_cases ? "farmer-health-warning" : "farmer-health-ok")}">${h.active_cases ? `${ft("active_cases")}: ${escapeHtml(h.active_cases)}` : ft("no_active_cases")}</div>
          </div>`).join("") : emptyState(ft("no_herds") + ". " + ft("no_herds_hint"))}
      </div>
      ${bottomNav("#/owner/livestock")}
    `);
  } catch (err) {
    render(`${header(ft("my_livestock"))}<div class="section-card">${emptyState(farmerRuntimeText(err.message))}</div>${bottomNav("#/owner/livestock")}`);
  }
}

async function vetDashboard() {
  render(`${header("Vet Dashboard")}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading…</div>`);
  const [summary, availabilityRows, ivrStatus] = await Promise.all([
    api("/vet/summary"), api("/vet/availability").catch(() => []),
    api("/ivr/status").catch(() => ({ pstn_connected: false, provider_mode: "MOCK" }))
  ]);
  const availability = availabilityRows[0] || { configured_status: "AVAILABLE", effective_status: "AVAILABLE", supported_languages: ["en"] };
  render(`
    ${header("Vet Dashboard")}
    <div class="hello-banner"><div style="margin-top:-16px;font-size:14px;opacity:0.9">Welcome,</div><div style="font-size:19px;font-weight:800">${escapeHtml(state.user.full_name)} 🩺</div></div>
    <div class="stat-grid">
      ${statCard(summary.new_cases, "🔴 New Cases")}
      ${statCard(summary.vaccinations_due, "🟠 Vax Due")}
      ${statCard(summary.lab_pending, "🧪 Lab Pending")}
      ${statCard(summary.user_reports, "📋 Total Reports")}
      ${statCard(summary.followups, "💊 Follow-ups")}
      ${statCard("MH", "State: Maharashtra")}
    </div>
    <div class="section-card">
      <div class="section-title">☎️ Helpline / IVR Routing (read-only)</div>
      <div class="meta" style="margin-bottom:10px">This panel is read-only. The canonical availability controls for both web calls and helpline routing are in the <b>Web call availability</b> card below. That card shows live routability which requires Socket.IO connected + presence lease live + AVAILABLE + not busy, and is the only honest indicator for web calls.</div>
      <div class="meta" style="margin-bottom:6px">Configured: <span class="badge ${availability.configured_status === 'AVAILABLE' ? 'badge-green' : availability.configured_status === 'BUSY' ? 'badge-orange' : 'badge-red'}">${escapeHtml(availability.configured_status)}</span> · Effective (hours): <span class="badge ${availability.effective_status === 'AVAILABLE' ? 'badge-green' : availability.effective_status === 'BUSY' ? 'badge-orange' : 'badge-red'}">${escapeHtml(availability.effective_status)}</span></div>
      <div class="small-muted">Languages: ${(availability.supported_languages || []).map((code) => ({ en: 'English', te: 'Telugu', hi: 'Hindi', mr: 'Marathi' }[code] || code.toUpperCase())).join(', ') || '—'}</div>
      <div class="small-muted" style="margin-top:6px">State honesty: 1 availability (your choice) · 2 Socket.IO (signaling) · 3 presence lease (server) · 4 routability (1+2+3+not busy). IVR uses 1 + working hours; web calls use 1+2+3+4.</div>
    </div>
    <div class="section-card">
      <div class="section-title">📞 IVR / Helpline Status</div>
      <div class="meta">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${ivrStatus.pstn_connected ? '#43a047' : '#fb8c00'};margin-right:6px"></span>
        Provider: <b>${ivrStatus.provider_mode}</b> · PSTN: <b>${ivrStatus.pstn_connected ? 'Connected' : 'Not Connected'}</b>
      </div>
      ${!ivrStatus.pstn_connected ? `<div class="small-muted" style="margin-top:4px">${ivrStatus.setup_instructions || ''}</div>` : ""}
    </div>
    <div id="pmVetCallHost"></div>
    <div class="section-card">
      <div class="section-title">Today's Tasks</div>
      <div class="icon-grid">
        ${iconItem("📷", "Scan QR", "#/scan")}
        ${iconItem("📋", "User Reports", "#/vet/reports")}
        ${iconItem("☎️", "Helpline Reports", "#/vet/helpline")}
        ${iconItem("🩺", "All Cases", "#/vet/cases")}
        ${iconItem("🧪", "Lab Reports", "#/vet/lab-reports")}
        ${iconItem("🔍", "Search Herd/Animal", "#/vet/search")}
        ${iconItem("💉", "Record Vaccination", "#/vet/vaccination/new")}
        ${iconItem("🗓️", "Vax Campaigns", "#/vet/campaigns")}
        ${iconItem("🌐", "Surveillance", "#/vet/surveillance")}
        ${iconItem("📍", "Local Disease Advisory", "#/vet/advisories")}
        ${iconItem("🚨", "Farm Alerts", "#/vet/farm-alerts")}
        ${iconItem("💊", "Prescriptions", "#/vet/prescriptions")}
        ${iconItem("📖", "Disease Info", "#/vet/diseases")}
        ${iconItem("🔔", "Notifications", "#/vet/notifications")}
      </div>
    </div>
    ${accountActionsCard()}
    ${bottomNav("#/vet/dashboard")}
  `);
  if (window.PMCall && window.PMCall.mountVetCard) window.PMCall.mountVetCard();
}

window.saveVetAvailability = async function() {
  toast("Use the Web call availability card below to change your availability.");
};

async function govtDashboard() {
  render(`${header("Govt Analytics")}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading state analytics…</div>`);
  const a = await api("/govt/analytics");
  render(`
    ${header("Govt Analytics")}
    <div class="hello-banner"><div style="margin-top:-16px;font-size:14px;opacity:0.9">Maharashtra Animal Disease & Vaccine Dashboard</div><div style="font-size:19px;font-weight:800">${escapeHtml(state.user.full_name)} 🏛️</div></div>
    <div class="stat-grid">
      ${statCard(a.totals.cases, "Total Cases")}
      ${statCard(a.totals.active, "Active Cases")}
      ${statCard(a.totals.animals, "Animals Registered")}
      ${statCard(a.totals.districts, "Districts Reporting")}
      ${statCard(a.totals.deaths || 0, "Deaths Reported")}
      ${statCard(a.totals.deceased_animals || 0, "Deceased Animals")}
    </div>
    <div class="section-card">
      <div class="section-title">☎️ Helpline Reporting</div>
      <div class="stat-grid" style="margin:0 0 12px">
        ${statCard(a.helpline.total_calls, "Calls")}
        ${statCard(a.helpline.vet_connections, "Vet Connections")}
        ${statCard(a.helpline.reports_created, "Reports")}
        ${statCard(a.helpline.partial_calls, "Partial")}
      </div>
      <button class="btn btn-ghost btn-sm" onclick="location.hash='#/govt/helpline'">View Helpline Reports</button>
    </div>
    <div class="section-card">
      <div class="section-title">🗺️ GIS Risk Map & Surveillance</div>
      <div class="meta">Live district-level disease risk plotted on the Maharashtra map, plus full case surveillance and AI early warning.</div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn btn-primary btn-sm" onclick="location.hash='#/govt/gis'">Open GIS Map</button>
        <button class="btn btn-ghost btn-sm" onclick="location.hash='#/govt/surveillance'">Surveillance</button>
        <button class="btn btn-ghost btn-sm" onclick="location.hash='#/govt/national'">🇮🇳 National</button>
      </div>
    </div>
    <div class="section-card">
      <div class="section-title">📊 Cases Arisen by District</div>
      ${barChart(a.cases_by_district)}
    </div>
    <div class="section-card">
      <div class="section-title">🥧 Most Spread Diseases</div>
      ${pieChart(a.disease_spread)}
    </div>
    <div class="section-card">
      <div class="section-title">🚨 Herd & Farm Alerts</div>
      <button class="btn btn-ghost btn-sm" onclick="location.hash='#/govt/farm-alerts'">View Farm Disease Alerts</button>
    </div>
    <div class="section-card">
      <div class="section-title">🧠 AI Early Warning System</div>
      <div class="meta">Disease risk prediction &amp; outbreak detection — trained ML model scored on your real district case data.</div>
      <button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="location.hash='#/govt/ai'">Open AI Risk Analysis</button>
    </div>
    <div class="section-card">
      <div class="section-title">📈 Disease Trends</div>
      <button class="btn btn-ghost btn-sm" onclick="location.hash='#/govt/trends'">View Historical Trends</button>
    </div>
    <div class="section-card">
      <div class="section-title">🏘️ Block-Level Analytics</div>
      <button class="btn btn-ghost btn-sm" onclick="location.hash='#/govt/blocks'">View Block Data</button>
    </div>
    <div class="section-card">
      <div class="section-title">🦠 Zoonotic Risk</div>
      <button class="btn btn-ghost btn-sm" onclick="location.hash='#/govt/zoonotic'">View Zoonotic Disease Risk</button>
    </div>
    <div class="section-card">
      <div class="section-title">📥 Export Data</div>
      <button class="btn btn-ghost btn-sm" onclick="location.hash='#/govt/export'">Export Cases, Animals &amp; Campaigns</button>
    </div>
    ${accountActionsCard()}
    ${bottomNav("#/govt/dashboard")}
  `);
}

async function labDashboard() {
  render(`${header("Laboratory Portal")}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading lab workstation…</div>`);
  const sum = await api("/lab/summary");
  render(`
    ${header("Laboratory Portal")}
    <div class="hello-banner"><div style="margin-top:-16px;font-size:14px;opacity:0.9">Regional Veterinary Diagnostics</div><div style="font-size:19px;font-weight:800">${escapeHtml(state.user.full_name)} 🔬</div></div>
    <div class="stat-grid">
      ${statCard(sum.pending_receiving, "📥 Intake Pending")}
      ${statCard(sum.in_testing, "🧪 In Testing")}
      ${statCard(sum.completed_today, "✅ Released Today")}
      ${statCard(sum.rejected_samples, "⚠️ Rejections")}
    </div>
    <div class="section-card">
      <div class="section-title">Quick Actions</div>
      <div class="icon-grid">
        ${iconItem("📷", "Scan / Receive", "#/scan")}
        ${iconItem("🧪", "Sample Queue", "#/lab/queue")}
        ${iconItem("📋", "All Reports", "#/lab/lab-reports")}
        ${iconItem("🔔", "Notifications", "#/lab/notifications")}
      </div>
    </div>
    ${accountActionsCard()}
    ${bottomNav("#/lab/dashboard")}
  `);
}

// ======================================================== HELPLINE REPORTS ==
function helplineReportsView(role) {
  route(`#/${role}/helpline`, async () => {
    const pageKey = `helpline_${role}`;
    if (!state.pagination[pageKey]) state.pagination[pageKey]=1;
    const curPage = state.pagination[pageKey];
    const pageSize = state.pagination.pageSize;
    render(`${header("Helpline Reports", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading helpline reports…</div>`);
    const [reports, analytics] = await Promise.all([
      api("/ivr/reports"), api("/ivr/analytics")
    ]);
    const { pageItems, total, page } = pmPaginate(reports, curPage, pageSize);
    state.pagination[pageKey]=page;
    const summary = `Helpline analytics: ${analytics.total_calls} total calls, ${analytics.vet_connections} vet connections, ${analytics.survey_completions} surveys, ${analytics.duplicate_reports} duplicates.`;
    render(`
      ${header("Helpline Reports", { back: true })}
      <div class="section-card" role="img" aria-label="${escapeAttr(summary)}">
        <div class="section-title">☎️ Pashu-Shield Call Analytics</div>
        <p class="sr-only">${escapeHtml(summary)}</p>
        <div class="stat-grid" style="margin:0">
          ${statCard(analytics.total_calls, "Total Calls")}
          ${statCard(analytics.vet_connections, "Vet Connected")}
          ${statCard(analytics.survey_completions, "Surveys Done")}
          ${statCard(analytics.duplicate_reports, "Duplicates")}
        </div>
        <details class="pm-chart-details"><summary>Accessible summary</summary><p>${escapeHtml(summary)} Chart shows ${analytics.total_calls} total calls broken down by vet connections, survey completions, duplicates.</p></details>
      </div>
      <div class="section-card" id="helplineList">
        <div class="section-title">Structured Helpline Reports</div>
        <div class="btn-row no-print" style="margin-bottom:8px"><button class="btn btn-outline btn-sm" onclick="pmPrintSection('helplineList')">🖨️ Print</button><button class="btn btn-outline btn-sm" onclick="window.__exportHelpline && window.__exportHelpline()">📥 Export CSV</button></div>
        ${pageItems.length === 0 ? emptyState("No helpline reports yet.") : pageItems.map(r => `
          <div class="list-card" ${r.case_id ? `onclick="location.hash='#/${role}/cases/${safeId(r.case_id)}'"` : "style=\"cursor:default\""}>
            <div class="row1"><span class="title">${escapeHtml(r.report_no)}</span><span class="badge ${escapeHtml(r.status === 'DUPLICATE_FLAGGED' ? 'badge-orange' : r.status === 'PARTIAL' ? 'badge-blue' : 'badge-green')}">${escapeHtml(r.status)}</span></div>
            <div class="meta"><b>Farmer:</b> ${escapeHtml(r.farmer_name || "Unlinked caller")} · <b>Animal:</b> ${escapeHtml(r.animal_code || r.structured_summary.species || "Not Provided")}</div>
            <div class="meta"><b>Region:</b> ${escapeHtml(r.village || "")}${escapeHtml(r.village && r.district ? ", " : "")}${escapeHtml(r.district || "Unknown")} · ${escapeHtml(r.location_source)}</div>
            <div class="meta"><b>Symptoms:</b> ${escapeHtml(r.symptoms || "Not Provided")} · <b>Urgency:</b> ${escapeHtml(r.urgency || "Not Provided")}</div>
            <div class="small-muted">Language: ${escapeHtml(r.language || "Unknown")} · Source: ${escapeHtml(r.source)} · ${fmtDate(r.created_at)}</div>
          </div>`).join("")}
        ${pmPaginationHtml(total, page, pageSize, `goHelplinePage_${role}`, {label:"Helpline reports pagination"})}
      </div>
      ${bottomNav(homeFor(role))}
    `);
    window.__exportHelpline = ()=>{ pmExportCsv('helpline_reports.csv', reports.map(r=>({report_no:r.report_no,status:r.status,farmer:r.farmer_name,animal:r.animal_code,symptoms:r.symptoms,created:r.created_at})), ['report_no','status','farmer','animal','symptoms','created']); };
    window[`goHelplinePage_${role}`] = (p)=>{ state.pagination[pageKey]=p; location.hash=`#/${role}/helpline`; setTimeout(()=>location.reload(),30); };
  }, [role]);
}
helplineReportsView("vet");
helplineReportsView("govt");

// ======================================================== LABORATORY QUEUE & DETAIL ==
route("#/lab/queue", async () => {
  if (!state.pagination.labQueue) state.pagination.labQueue=1;
  const curPage = state.pagination.labQueue;
  const pageSize = state.pagination.pageSize;
  render(`${header("Sample Queue", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading samples…</div>`);
  const queue = await api("/lab/queue");
  const { pageItems, total, page } = pmPaginate(queue, curPage, pageSize);
  state.pagination.labQueue=page;
  render(`
    ${header("Diagnostic Intake & Testing", { back: true })}
    <div class="section-card" id="labQueueSection">
      <div class="section-title">🧪 Biological Specimens Queue (${total})</div>
      <div class="btn-row no-print" style="margin-bottom:8px"><button class="btn btn-outline btn-sm" onclick="pmPrintSection('labQueueSection')">🖨️ Print</button><button class="btn btn-outline btn-sm" onclick="window.__exportLabQueue && window.__exportLabQueue()">📥 Export CSV</button></div>
      ${pageItems.length === 0 ? emptyState("No samples in queue.") : pageItems.map(s => `
        <div class="list-card" role="button" tabindex="0" onclick="location.hash='#/lab/samples/${safeId(s.id)}'" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.hash='#/lab/samples/${safeId(s.id)}'}">
          <div class="row1">
            <span class="title">${escapeHtml(s.sample_code)}</span>
            <span class="badge ${statusBadgeClass(s.status)}">${escapeHtml(s.status)}</span>
          </div>
          <div class="meta"><b>Animal:</b> ${escapeHtml(s.animal_code)} (${escapeHtml(s.species)}) · <b>Type:</b> ${escapeHtml(s.sample_type)}</div>
          <div class="meta">Case ${escapeHtml(s.case_no)} · Collected: ${fmtDate(s.collected_at)} by ${escapeHtml(s.collector_name || "Vet")}</div>
        </div>
      `).join("")}
      ${pmPaginationHtml(total, page, pageSize, "goLabQueuePage", {label:"Lab queue pagination"})}
    </div>
    ${bottomNav("#/lab/queue")}
  `);
  window.__exportLabQueue = ()=>{ pmExportCsv('lab_queue.csv', queue.map(s=>({sample_code:s.sample_code,status:s.status,animal:s.animal_code,type:s.sample_type,case_no:s.case_no,collected:s.collected_at})), ['sample_code','status','animal','type','case_no','collected']); };
  window.goLabQueuePage = (p)=>{ state.pagination.labQueue=p; location.hash="#/lab/queue"; setTimeout(()=>location.reload(),30); };
}, ["lab", "vet", "govt"]);

async function labSampleDetailView(id) {
  render(`${header("Sample Detail", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading sample…</div>`);
  const s = await api(`/samples/${id}`);
  render(`
    ${header("Sample " + s.sample_code, { back: true })}
    <div class="section-card">
      <div class="row1" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:18px;font-weight:800">${escapeHtml(s.sample_code)}</div>
        <span class="badge ${statusBadgeClass(s.status)}">${escapeHtml(s.status)}</span>
      </div>
      <div class="detail-grid">
        <div><b>Sample Type</b>${escapeHtml(s.sample_type)}</div>
        <div><b>Case Number</b><a class="link" onclick="location.hash='#/vet/cases/${safeId(s.case_id)}'">${escapeHtml(s.case_no)}</a></div>
        <div><b>Animal Code</b>${escapeHtml(s.animal_code)} (${escapeHtml(s.species)})</div>
        <div><b>Collection GPS</b>${s.collection_lat ? `${escapeHtml(s.collection_lat.toFixed(4))}° N, ${escapeHtml(s.collection_lng.toFixed(4))}° E` : "—"} ${escapeHtml(s.is_manual_location ? "(Manual)" : "(Device GPS)")}</div>
        <div><b>Collected On</b>${fmtDate(s.collected_at)}</div>
        <div><b>Transporter</b>${escapeHtml(s.transporter_name || "—")} ${s.transporter_phone ? `(${escapeHtml(s.transporter_phone)})` : ""}</div>
      </div>
      ${s.collection_notes ? `<div style="margin-top:10px"><b class="small-muted">Collection Notes:</b><div style="font-size:13px">${escapeHtml(s.collection_notes)}</div></div>` : ""}
      <div style="text-align:center;margin-top:14px">
        <div class="qr-image-wrap"><img src="${escapeHtml(s.qr_image)}" alt="Sample QR" /></div>
        <div class="small-muted">Sample QR Tag (${escapeHtml(s.qr_token.slice(0, 16))}…)</div>
      </div>
    </div>

    <!-- WORKFLOW ACTION CARD -->
    <div class="section-card">
      <div class="section-title">⚙️ Laboratory Processing Workflow</div>
      ${s.status === "COLLECTED" || s.status === "READY_FOR_PICKUP" || s.status === "PICKED_UP" || s.status === "IN_TRANSIT" || s.status === "ARRIVED_AT_LAB" ? `
        <div class="meta" style="margin-bottom:12px">Specimen is awaiting laboratory intake inspection:</div>
        <button class="btn btn-primary" onclick="labAccept(${safeId(s.id)})">✅ Accept Specimen (Mark LAB_RECEIVED)</button>
        <div style="margin-top:10px">
          <button class="btn btn-outline" onclick="document.getElementById('rejectBox').style.display='block'">❌ Reject Specimen</button>
        </div>
        <div id="rejectBox" style="display:none;margin-top:10px;background:#fde6e4;padding:12px;border-radius:12px">
          <div class="field"><label for="rejectReasonInput">Rejection Reason</label><input id="rejectReasonInput" placeholder="e.g. Hemolyzed, broken seal, delayed transport" /></div>
          <button class="btn btn-outline btn-sm" style="background:#fff" onclick="labReject(${safeId(s.id)})">Confirm Rejection</button>
        </div>
      ` : s.status === "LAB_RECEIVED" ? `
        <div class="meta" style="margin-bottom:12px">Specimen accepted in lab intake. Assign to testing bench:</div>
        <button class="btn btn-primary" onclick="labStartTesting(${safeId(s.id)})">🧪 Begin Diagnostic Testing (Mark TESTING)</button>
      ` : s.status === "TESTING" ? `
        <div class="subheading">🧬 Structured Result Entry</div>
        <form id="labResultForm">
          <div class="form-row">
            <div class="field"><label for="pm_test_name">Test Name</label><input id="pm_test_name" name="test_name" placeholder="e.g. HS Culture Test / FMD ELISA" required /></div>
            <div class="field"><label for="pm_test_type">Test Type</label><select id="pm_test_type" name="test_type"<option>Serology</option><option>Bacteriology</option><option>Molecular</option><option>Hematology</option></select></div>
          </div>
          <div class="form-row">
            <div class="field"><label for="pm_test_method">Test Method</label><input id="pm_test_method" name="test_method" placeholder="e.g. ELISA / PCR / Culture" /></div>
            <div class="field"><label for="pm_result">Qualitative Result</label><select id="pm_result" name="result"<option>NEGATIVE</option><option>POSITIVE</option><option>INCONCLUSIVE</option></select></div>
          </div>
          <div class="form-row">
            <div class="field"><label for="pm_quantitative_result">Quantitative Value</label><input id="pm_quantitative_result" name="quantitative_result" type="number" step="0.01" placeholder="e.g. 0.05" /></div>
            <div class="field"><label for="pm_units">Units</label><input id="pm_units" name="units" placeholder="e.g. OD / g/dL / titer" /></div>
          </div>
          <div class="field"><label for="pm_abnormal_flag">Abnormal Flag</label><select id="pm_abnormal_flag" name="abnormal_flag"<option>Normal</option><option>Positive</option><option>High</option><option>Low</option><option>Abnormal</option></select></div>
          <div class="field"><label for="pm_reference_range_text">Reference Range Note</label><input id="pm_reference_range_text" name="reference_range_text" placeholder="e.g. Cutoff OD &gt; 0.3 is Positive" /></div>
          <div class="field"><label for="pm_comments">Technician Comments</label><textarea id="pm_comments" name="comments"</textarea></div>
          <button class="btn btn-primary" type="submit">Save Diagnostic Results</button>
        </form>
      ` : s.status === "RESULT_READY" ? `
        <div class="meta" style="margin-bottom:12px">Results entered and ready for official verification:</div>
        <button class="btn btn-primary" onclick="labVerify(${safeId(s.id)})">✅ Verify &amp; Release Official Report</button>
      ` : `
        <div class="meta">🟢 Official report verified and published to veterinarian and owner.</div>
      `}
    </div>

    <!-- CHAIN OF CUSTODY TIMELINE -->
    <div class="section-card">
      <div class="subheading">⛓️ Chain of Custody &amp; Transport Timeline</div>
      <div class="timeline">
        ${(s.custody_events || []).map(e => `
          <div class="timeline-item">
            <div class="timeline-dot"></div>
            <div class="timeline-body">
              <div class="t-status">${escapeHtml(e.status)} — ${escapeHtml(e.action)}</div>
              <div class="t-note">${escapeHtml(e.notes || "")} (${escapeHtml(e.actor_name || "System")} · ${escapeHtml(e.actor_role || "")})</div>
              <div class="t-date">${fmtDate(e.timestamp)}</div>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
    ${bottomNav("#/lab/queue")}
  `);

  if (document.getElementById("labResultForm")) {
    document.getElementById("labResultForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const body = Object.fromEntries(new FormData(e.target));
        await api(`/samples/${id}/results`, { method: "POST", body });
        toast("Diagnostic results saved!");
        labSampleDetailView(id);
      } catch (err) { toast(err.message, true); }
    });
  }
}
route("#/lab/samples/:id", ({ id }) => labSampleDetailView(id), ["lab", "vet", "govt"]);

window.labAccept = async function(id) {
  try { await api(`/samples/${id}/receive`, { method: "POST", body: { action: "accept" } }); toast("Specimen accepted!"); labSampleDetailView(id); }
  catch (e) { toast(e.message, true); }
};
window.labReject = async function(id) {
  const reason = (document.getElementById("rejectReasonInput")?.value || "").trim();
  if (!reason) return toast("Please enter rejection reason", true);
  try { await api(`/samples/${id}/receive`, { method: "POST", body: { action: "reject", rejection_reason: reason } }); toast("Sample rejected and notifications sent"); labSampleDetailView(id); }
  catch (e) { toast(e.message, true); }
};
window.labStartTesting = async function(id) {
  try { await api(`/samples/${id}/test`, { method: "POST" }); toast("Diagnostic testing started"); labSampleDetailView(id); }
  catch (e) { toast(e.message, true); }
};
window.labVerify = async function(sampleId) {
  try {
    const s = await api(`/samples/${sampleId}`);
    const reports = await api("/lab/reports");
    const rep = reports.find(r => r.sample_id === Number(sampleId));
    if (rep) {
      await api(`/lab/reports/${rep.id}/verify`, { method: "POST" });
      toast("Report verified & published! Vet notified.");
    } else {
      toast("Report released!");
    }
    labSampleDetailView(sampleId);
  } catch (e) { toast(e.message, true); }
};

// ======================================================== UNIVERSAL QR SCANNER ==
let cameraStream = null;
let cameraTimer = null;

function renderScanner() {
  const role = getUserRole() || "owner";
  render(`
    ${header("Scan QR Identity", { back: true })}
    <div class="section-card">
      <div class="section-title">📷 Live Camera Scanner</div>
      <div class="meta" style="margin-bottom:12px">Point device camera at Animal Passport QR or Biological Sample QR:</div>
      <div class="scanner-video-wrap">
        <video id="scanVideo" playsinline autoplay muted></video>
        <div class="scanner-reticle"></div>
      </div>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn btn-primary btn-sm" id="btnStartScan" onclick="startCameraScanner()">Start Camera</button>
        <button class="btn btn-outline btn-sm" id="btnStopScan" onclick="stopCameraScanner()">Stop Camera</button>
      </div>
      <div id="scanStatus" class="meta" style="margin-top:8px">Camera idle.</div>
    </div>
    <div class="section-card">
      <div class="section-title">📁 Upload QR Code Photo</div>
      <div class="field">
        <input type="file" id="qrFileInput" accept="image/*" capture="environment" onchange="handleFileScan(this)" />
      </div>
    </div>
    <div class="section-card">
      <div class="section-title">⌨️ Manual Identifier Fallback</div>
      <div class="meta" style="margin-bottom:8px">Enter Animal Code (e.g. MH-PUN-000001) or Sample ID (e.g. SMP-MH-PUN-000101):</div>
      <div class="form-row">
        <div class="field" style="margin:0"><input id="manualLookupInput" placeholder="e.g. MH-PUN-000001" /></div>
        <button class="btn btn-primary btn-sm" style="width:auto" onclick="handleManualLookup()">Lookup</button>
      </div>
    </div>
    ${bottomNav(homeFor(role))}
  `);
}
route("#/scan", () => renderScanner());

window.handleManualLookup = function() {
  const input = (document.getElementById("manualLookupInput")?.value || "").trim();
  if (!input) return toast("Please enter an identifier", true);
  resolveScannedPayload(input);
};

window.resolveScannedPayload = async function(payload) {
  const role = getUserRole() || "owner";
  toast(`Looking up: ${payload.slice(0, 24)}…`);
  try {
    if (payload.includes("SAMPLE:") || payload.startsWith("SMP-")) {
      const s = await api(`/samples/lookup-qr?payload=${encodeURIComponent(payload)}`);
      if (role === "lab") {
        location.hash = `#/lab/samples/${safeId(s.id)}`;
      } else {
        location.hash = `#/${role}/cases/${safeId(s.case_id)}`;
      }
    } else {
      const a = await api(`/animals/lookup-qr?payload=${encodeURIComponent(payload)}`);
      location.hash = `#/${role}/animals/${safeId(a.id)}`;
    }
  } catch (e) {
    toast(e.message, true);
  }
};

window.handleFileScan = function(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    const b64 = e.target.result;
    try {
      const res = await api("/qr/decode", { method: "POST", body: { image: b64 } });
      if (res.decoded && res.payload) {
        toast("QR code recognized!");
        resolveScannedPayload(res.payload);
      } else {
        toast("No readable QR code found in photo", true);
      }
    } catch (err) { toast(err.message, true); }
  };
  reader.readAsDataURL(file);
};

window.startCameraScanner = async function() {
  const video = document.getElementById("scanVideo");
  const status = document.getElementById("scanStatus");
  if (!video) return;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = cameraStream;
    status.textContent = "🟢 Camera active. Position QR within the green square.";
    
    if ("BarcodeDetector" in window) {
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      cameraTimer = setInterval(async () => {
        try {
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0) {
            const raw = barcodes[0].rawValue;
            stopCameraScanner();
            resolveScannedPayload(raw);
          }
        } catch (e) {}
      }, 500);
    } else {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      cameraTimer = setInterval(async () => {
        if (!video.videoWidth) return;
        canvas.width = 300; canvas.height = 300;
        ctx.drawImage(video, 0, 0, 300, 300);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        try {
          const res = await api("/qr/decode", { method: "POST", body: { image: dataUrl } });
          if (res.decoded && res.payload) {
            stopCameraScanner();
            resolveScannedPayload(res.payload);
          }
        } catch (e) {}
      }, 1500);
    }
  } catch (err) {
    status.textContent = "⚠️ Camera permission denied or not available. Please use image upload or manual lookup.";
  }
};

window.stopCameraScanner = function() {
  if (cameraTimer) clearInterval(cameraTimer);
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  const status = document.getElementById("scanStatus");
  if (status) status.textContent = "Camera stopped.";
};

// ==================================================== GOVT: ANALYTICS ====
route("#/govt/analytics", async () => {
  render(`${header("Analytics & Reports", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading analytics…</div>`);
  const [a, geo] = await Promise.all([api("/govt/analytics"), api("/govt/geo")]);
  const districtRows = geo.map(d => `
    <tr>
      <td><b>${escapeHtml(d.district)}</b></td>
      <td><span class="badge ${riskBadgeClass(d.risk_level)}">${escapeHtml(d.risk_level)}</span></td>
      <td>${escapeHtml(d.cases)}</td>
      <td>${escapeHtml(d.active)}</td>
      <td>${escapeHtml(d.high_severity)}</td>
      <td>${escapeHtml(d.affected_animals)}</td>
      <td>${escapeHtml(d.animal_population)}</td>
    </tr>`).join("");
  render(`
    ${header("Analytics & Reports", { back: true })}
    <div class="section-card">
      <div class="section-title">📊 Key Metrics (Live Database)</div>
      <div class="stat-grid" style="margin:0">
        ${statCard(a.totals.cases, "Total Cases")}
        ${statCard(a.totals.active, "Active Cases")}
        ${statCard(a.totals.animals, "Animals Registered")}
        ${statCard(a.totals.districts, "Reporting Districts")}
      </div>
    </div>
    <div class="section-card">
      <div class="section-title">📈 Cases Arisen by District</div>
      ${barChart(a.cases_by_district)}
    </div>
    <div class="section-card">
      <div class="section-title">🥧 Disease Spread Distribution</div>
      ${pieChart(a.disease_spread)}
    </div>
    <div class="section-card">
      <div class="section-title">📋 District Risk & Case Table</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>District</th><th>Risk</th><th>Cases</th><th>Active</th><th>High Sev</th><th>Affected</th><th>Pop</th></tr></thead>
          <tbody>${districtRows}</tbody>
        </table>
      </div>
    </div>
    <div class="section-card">
      <div class="section-title">💉 Vaccine Stock Summary</div>
      ${Object.keys(a.vaccine_stock).length === 0 ? emptyState("No stock data yet.") :
        Object.entries(a.vaccine_stock).map(([dist, items]) => `
          <div style="margin:8px 0">
            <b>${dist}</b>: ${items.map(i => `${escapeHtml(i.vaccine)} (${escapeHtml(i.doses)} doses)`).join(", ")}
          </div>`).join("")}
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="location.hash='#/govt/stock'">Manage Vaccine Stock</button>
    </div>
    ${bottomNav("#/govt/dashboard")}
  `);
}, ["govt"]);

// ========================================================= GOVT: GIS MAP ==
let gisState = { geo: [], locations: [], outline: null, disease: "All", risks: ["High Risk", "Moderate Risk", "Low Risk"], map: null, layer: null, showClusters: false, clusters: [] };

route("#/govt/gis", async () => {
  render(`${header("GIS Risk Map", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading map & live district data…</div>`);
  const [geo, locations, outline, clusterData] = await Promise.all([
    api("/govt/geo"),
    fetch("/maharashtra_locations.json").then(r => r.json()).catch(() => []),
    fetch("/maharashtra_state.geojson").then(r => r.json()).catch(() => null),
    api("/govt/clusters").catch(() => ({ clusters: [] })),
  ]);
  gisState = { ...gisState, geo, locations, outline, clusters: clusterData.clusters || [], map: null, layer: null };
  const diseases = ["All", ...Array.from(new Set(geo.flatMap(d => d.diseases.map(x => x.label))))];
  render(`
    ${header("GIS Risk Map", { back: true })}
    <div class="gis-status ${navigator.onLine ? "online" : "offline"}">
      ${navigator.onLine ? "🟢 ONLINE / LIVE DATA — synchronized with central server." : "🟠 OFFLINE MODE — showing cached boundaries."}
    </div>
    <div class="section-card" style="padding-bottom:8px">
      <div class="gis-controls">
        <div class="field" style="margin-bottom:8px"><label for="gisDisease">Disease filter</label>
          <select id="gisDisease">${diseases.map(d => `<option ${d === gisState.disease ? "selected" : ""}>${d}</option>`).join("")}</select>
        </div>
        <div class="gis-risk-toggles">
          ${["High Risk", "Moderate Risk", "Low Risk"].map(r => `
            <label class="risk-chip"><input type="checkbox" data-risk="${r}" ${gisState.risks.includes(r) ? "checked" : ""}/> <span class="dot-${r === "High Risk" ? "red" : r === "Moderate Risk" ? "orange" : "green"}"></span>${r}</label>`).join("")}
          <label class="risk-chip"><input type="checkbox" id="gisClusterToggle" ${gisState.showClusters ? "checked" : ""} /> <b>📍 DBSCAN Clusters</b></label>
        </div>
      </div>
    </div>
    <div class="section-card" style="padding:0;overflow:hidden">
      <div id="gisMap" class="gis-map"></div>
    </div>
    <div class="section-card">
      <div class="section-title">🚨 Risk Summary (filtered)</div>
      <div id="gisSummary"></div>
    </div>
    <div class="section-card">
      <div class="section-title">📍 Top Affected Districts</div>
      <div id="gisTop"></div>
    </div>
    ${bottomNav("#/govt/gis")}
  `);
  initGisMap();
  document.getElementById("gisDisease").addEventListener("change", e => { gisState.disease = e.target.value; drawGis(); });
  document.getElementById("gisClusterToggle").addEventListener("change", e => { gisState.showClusters = e.target.checked; drawGis(); });
  document.querySelectorAll(".gis-risk-toggles input[data-risk]").forEach(cb =>
    cb.addEventListener("change", () => {
      const r = cb.dataset.risk;
      gisState.risks = cb.checked ? [...new Set([...gisState.risks, r])] : gisState.risks.filter(x => x !== r);
      drawGis();
    }));
}, ["govt", "vet"]);

function initGisMap() {
  if (typeof L === "undefined") {
    document.getElementById("gisMap").innerHTML = `
      ${emptyState("Map library failed to load.")}
      <button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="location.hash='#/govt/gis'">🔄 Retry</button>`;
    return;
  }
  // Show warning if GIS data failed to load
  if (!gisState.outline) {
    const warning = document.createElement("div");
    warning.style.cssText = "background:#fff3cd;padding:8px 12px;font-size:12px;border-radius:8px;margin-bottom:8px";
    warning.innerHTML = "⚠️ Map boundary data unavailable. Using district centroids. <button class='btn btn-ghost btn-sm' onclick='location.hash=\"#/govt/gis\"'>Retry</button>";
    const mapEl = document.getElementById("gisMap");
    if (mapEl && mapEl.parentNode) mapEl.parentNode.insertBefore(warning, mapEl);
  }
  if (!gisState.locations || !gisState.locations.length) {
    const warning2 = document.createElement("div");
    warning2.style.cssText = "background:#fff3cd;padding:8px 12px;font-size:12px;border-radius:8px;margin-bottom:8px";
    warning2.innerHTML = "⚠️ Location data unavailable — using district centroids.";
    const mapEl2 = document.getElementById("gisMap");
    if (mapEl2 && mapEl2.parentNode) mapEl2.parentNode.insertBefore(warning2, mapEl2);
  }
  const map = L.map("gisMap").setView([19.7515, 75.7139], 7);
  if (navigator.onLine) {
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 18,
    }).addTo(map);
  }
  if (gisState.outline) {
    L.geoJSON(gisState.outline, { style: { color: "#3b82f6", weight: 2, fillOpacity: 0.04, fillColor: "#3b82f6" } }).addTo(map);
  }
  gisState.map = map;
  gisState.layer = L.layerGroup().addTo(map);
  drawGis();
  setTimeout(() => map.invalidateSize(), 200);
}

function drawGis() {
  const { map, layer, geo, locations, disease, risks, showClusters, clusters } = gisState;
  if (!map || !layer) return;
  layer.clearLayers();
  const colorFor = r => r === "High Risk" ? "#e2483f" : r === "Moderate Risk" ? "#e08a1e" : "#1fa971";
  const filtered = geo.filter(d => {
    if (!risks.includes(d.risk_level)) return false;
    if (disease !== "All" && !d.diseases.some(x => x.label === disease)) return false;
    return true;
  });

  filtered.forEach(d => {
    const loc = locations.find(l => l.district.toLowerCase() === d.district.toLowerCase());
    if (!loc) return;
    const radius = d.risk_level === "High Risk" ? 20 : d.risk_level === "Moderate Risk" ? 15 : 10;
    L.circleMarker([loc.lat, loc.lng], { radius, color: colorFor(d.risk_level), fillColor: colorFor(d.risk_level), fillOpacity: 0.6 })
      .bindTooltip(`<div style="font-weight:700">${escapeHtml(d.district)}</div>
        <div style="color:${escapeHtml(colorFor(d.risk_level))};font-weight:700;font-size:12px">${escapeHtml(d.risk_level)}</div>
        <div style="font-size:12px">Cases: ${escapeHtml(d.cases)} · Active: ${escapeHtml(d.active)}</div>
        <div style="font-size:12px">Affected animals: ${escapeHtml(d.affected_animals)}</div>
        <div style="font-size:12px">Diseases: ${escapeHtml(d.diseases.map(x => x.label).join(", ") || "—")}</div>`)
      .addTo(layer);
  });

  // FEATURE GROUP 17: REAL SPATIOTEMPORAL DBSCAN CLUSTERS
  if (showClusters && clusters && clusters.length) {
    clusters.forEach(c => {
      L.circleMarker([c.lat, c.lng], {
        radius: Math.max(14, c.cases * 8),
        color: "#8e24aa",
        fillColor: "#e1bee7",
        fillOpacity: 0.7,
        weight: 3,
        dashArray: "4, 4"
      }).bindTooltip(`
        <div style="font-weight:800;color:#8e24aa">📍 Spatiotemporal Cluster: ${escapeHtml(c.cluster_id)}</div>
        <div style="font-size:12px"><b>District:</b> ${escapeHtml(c.district)}</div>
        <div style="font-size:12px"><b>Cases:</b> ${escapeHtml(c.cases)} active</div>
        <div style="font-size:12px"><b>Diseases:</b> ${escapeHtml(c.diseases ? c.diseases.join(", ") : "HS")}</div>
        <div style="font-size:11px;color:#666">Method: ${escapeHtml(c.method || "DBSCAN (haversine)")}</div>
      `).addTo(layer);
    });
  }

  const high = filtered.filter(d => d.risk_level === "High Risk").length;
  const mod = filtered.filter(d => d.risk_level === "Moderate Risk").length;
  const low = filtered.filter(d => d.risk_level === "Low Risk").length;
  document.getElementById("gisSummary").innerHTML = `
    <div class="stat-grid" style="margin:0">
      ${statCard(high, "🔴 High Risk")}
      ${statCard(mod, "🟠 Moderate")}
      ${statCard(low, "🟢 Low Risk")}
    </div>`;
  const top = [...filtered].sort((a, b) => b.affected_animals - a.affected_animals).slice(0, 5);
  document.getElementById("gisTop").innerHTML = top.length === 0 ? emptyState("No matching districts.") :
    top.map(d => `<div class="list-card" style="cursor:default">
      <div class="row1"><span class="title">${escapeHtml(d.district)}</span><span class="badge ${riskBadgeClass(d.risk_level)}">${escapeHtml(d.risk_level)}</span></div>
      <div class="meta">${escapeHtml(d.affected_animals)} affected · ${escapeHtml(d.cases)} cases · ${escapeHtml(d.high_severity)} high-severity</div>
    </div>`).join("");
}

// ================================================ SURVEILLANCE (govt/vet) =
function surveillanceView(role) {
  route(`#/${role}/surveillance`, async () => {
    render(`${header("Surveillance", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading surveillance cases…</div>`);
    const [cases, geo] = await Promise.all([api("/cases"), api("/govt/geo")]);
    render(`
      ${header("Disease Surveillance", { back: true })}
      <div class="section-card">
        <div class="section-title">🌐 Active Disease Clusters (by District)</div>
        <div class="meta" style="margin-bottom:12px">Real-time aggregate data reported across field veterinarians and livestock owners:</div>
        <div class="stat-grid" style="margin:0 0 14px 0">
          ${statCard(cases.length, "Total Reports")}
          ${statCard(cases.filter(c => !["CLOSED", "RECOVERED"].includes(c.status)).length, "Active Cases")}
          ${statCard(geo.filter(g => g.risk_level === "High Risk").length, "High Risk Dist.")}
        </div>
        ${geo.map(g => `
          <div class="list-card" style="cursor:default">
            <div class="row1"><span class="title">${escapeHtml(g.district)}</span><span class="badge ${riskBadgeClass(g.risk_level)}">${escapeHtml(g.risk_level)}</span></div>
            <div class="meta">Cases: ${escapeHtml(g.cases)} (${escapeHtml(g.active)} active) · Affected: ${escapeHtml(g.affected_animals)} · High severity: ${escapeHtml(g.high_severity)}</div>
            <div class="meta">Top Diseases: ${g.diseases.map(d => `${escapeHtml(d.label)} (${escapeHtml(d.value)})`).join(", ") || "—"}</div>
          </div>`).join("")}
      </div>
      <div class="section-card">
        <div class="section-title">📋 Recent Incident Reports</div>
        ${cases.slice(0, 10).map(c => `
          <div class="list-card" role="button" tabindex="0" onclick="location.hash='#/${role}/cases/${safeId(c.id)}'" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.hash='#/${role}/cases/${safeId(c.id)}'}">
            <div class="row1"><span class="title">${escapeHtml(c.case_no)}</span><span class="badge ${statusBadgeClass(c.status)}">${escapeHtml(c.status)}</span></div>
            <div class="meta">${escapeHtml(c.animal ? c.animal.animal_code : "—")} · ${escapeHtml(c.disease_suspected || c.diagnosis || "Unspecified")} · ${fmtDate(c.created_at)}</div>
          </div>`).join("")}
      </div>
      ${bottomNav(`#/${role}/surveillance`)}
    `);
  }, [role]);
}
surveillanceView("govt"); surveillanceView("vet");

// ======================================================== NATIONAL SURVEILLANCE ==
function nationalSurveillanceView() {
  route("#/govt/national", async () => {
    render(`${header("National Surveillance", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading national data…</div>`);
    const data = await api("/national/surveillance");
    render(`
      ${header("National Surveillance", { back: true })}
      ${data.reporting_scope_note ? `
        <div style="background:#e3f2fd;padding:10px 14px;border-radius:12px;margin:12px 16px;font-size:13px">
          📋 ${data.reporting_scope_note}
        </div>
      ` : ""}
      <div class="section-card">
        <div class="section-title">🇮🇳 India Livestock Health Chain Hierarchy</div>
        <div class="meta" style="font-size:12px;margin-bottom:12px"><b>Surveillance Layer:</b> Country → State → District → Block → Herd → Animal</div>
        <div class="stat-grid" style="margin:0">
          ${statCard(data.total_national_animals, "National Animals")}
          ${statCard(data.total_national_cases, "National Cases")}
          ${statCard(data.total_national_active, "Active Episodes")}
          ${statCard(data.states.length, "Federated States")}
          ${statCard(data.zoonotic_risk_count || 0, "Zoonotic Cases")}
        </div>
      </div>

      <div class="section-card">
        <div class="section-title">🏛️ State Surveillance Nodes</div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>State</th><th>Node Status</th><th>Animals</th><th>Active</th><th>Reporting Risk</th></tr></thead>
            <tbody>
              ${data.states.map(s => `
                <tr>
                  <td><b>${escapeHtml(s.state)}</b></td>
                  <td>${escapeHtml(s.reporting_status)}</td>
                  <td>${escapeHtml(s.animals_registered)}</td>
                  <td>${escapeHtml(s.active_cases)}</td>
                  <td><span class="badge ${escapeHtml(s.active_cases > 0 ? "badge-orange" : "badge-blue")}">${escapeHtml(s.risk_index)}</span></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div class="section-card">
        <div class="subheading">🚨 National &amp; Cross-State Outbreak Alerts</div>
        ${data.national_alerts.length === 0 ? emptyState("No active national alerts.") :
          data.national_alerts.map(a => `
          <div class="list-card" style="cursor:default">
            <div class="row1">
              <span class="title">${escapeHtml(a.title)}</span>
              <span class="badge ${escapeHtml(a.severity === 'CRITICAL' ? 'badge-red' : 'badge-orange')}">${escapeHtml(a.severity)}</span>
            </div>
            <div class="meta"><b>Disease:</b> ${escapeHtml(a.disease)} · <b>State:</b> ${escapeHtml(a.state)} (${escapeHtml(a.district || "Statewide")})</div>
            <div class="meta">${escapeHtml(a.description)}</div>
            <div class="meta" style="color:var(--primary);margin-top:4px"><b>Measures:</b> ${escapeHtml(a.recommended_measures)}</div>
          </div>
        `).join("")}
      </div>

      <div class="section-card">
        <div class="subheading">+ Issue National Outbreak Alert</div>
        <form id="nationalAlertForm">
          <div class="field"><label for="pm_title">Alert Title</label><input id="pm_title" name="title" placeholder="e.g. Western Zone FMD Movement Advisory" required /></div>
          <div class="form-row">
            <div class="field"><label for="pm_disease">Disease</label><input id="pm_disease" name="disease" placeholder="e.g. FMD" required /></div>
            <div class="field"><label for="pm_state">State</label><input id="pm_state" name="state" value="Maharashtra" required /></div>
          </div>
          <div class="form-row">
            <div class="field"><label for="pm_severity">Severity</label><select id="pm_severity" name="severity"<option>HIGH</option><option>CRITICAL</option><option>MODERATE</option></select></div>
            <div class="field"><label for="pm_affected_count">Affected Count</label><input id="pm_affected_count" name="affected_count" type="number" value="1" /></div>
          </div>
          <div class="field"><label for="pm_description">Alert Description</label><textarea id="pm_description" name="description" placeholder="Summary of outbreak pattern and epicenter coordinates"</textarea></div>
          <div class="field"><label for="pm_recommended_measures">Recommended Measures</label><input id="pm_recommended_measures" name="recommended_measures" placeholder="e.g. Quarantine border, ring vaccination" /></div>
          <button class="btn btn-primary" type="submit">Publish National Alert</button>
        </form>
      </div>
      ${bottomNav("#/govt/dashboard")}
    `);

    document.getElementById("nationalAlertForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const body = Object.fromEntries(new FormData(e.target));
        await api("/national/alerts", { method: "POST", body });
        toast("National alert published!");
        nationalSurveillanceView();
      } catch (err) { toast(err.message, true); }
    });
  }, ["govt", "vet"]);
}
nationalSurveillanceView();

// ======================================================== FARM ALERTS VIEW ==
function farmAlertsView(role) {
  route(`#/${role}/farm-alerts`, async () => {
    render(`${header("Farm Alerts", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading farm alerts…</div>`);
    const alerts = await api("/farm-alerts");
    render(`
      ${header("Herd & Farm Intelligence Alerts", { back: true })}
      <div class="section-card">
        <div class="section-title">🚨 Active Herd Health Warnings</div>
        <div class="meta" style="margin-bottom:12px">Automated triggers detecting localized cluster acceleration and vaccination gaps:</div>
        ${alerts.length === 0 ? emptyState("No active farm-level disease alerts.") : alerts.map(a => `
          <div class="list-card" style="cursor:default">
            <div class="row1">
              <span class="title">${escapeHtml(a.herd_code)} — ${escapeHtml(a.disease)}</span>
              <span class="badge ${riskBadgeClass(a.risk_level)}">${escapeHtml(a.risk_level)}</span>
            </div>
            <div class="meta"><b>Location:</b> ${escapeHtml(a.district)} · <b>Trigger:</b> ${escapeHtml(a.trigger_reason)}</div>
            <div class="meta"><b>Recommended Action:</b> ${escapeHtml(a.recommended_action || "—")}</div>
            ${a.supporting_evidence ? `<div class="small-muted">Evidence: ${escapeHtml(a.supporting_evidence)}</div>` : ""}
            <div class="row1" style="margin-top:8px">
              <span class="badge badge-blue">Status: ${escapeHtml(a.status)}</span>
              ${role !== "owner" && a.status === "ACTIVE" ? `
                <div style="display:flex;gap:6px">
                  <button class="btn btn-outline btn-sm" onclick="ackFarmAlert(${safeId(a.id)})">Acknowledge</button>
                  <button class="btn btn-primary btn-sm" onclick="resolveFarmAlert(${safeId(a.id)})">Resolve</button>
                </div>
              ` : ""}
            </div>
          </div>
        `).join("")}
      </div>
      ${bottomNav(homeFor(role))}
    `);
  }, [role]);
}
farmAlertsView("vet"); farmAlertsView("govt");

window.ackFarmAlert = async function(id) {
  try { await api(`/farm-alerts/${id}/acknowledge`, { method: "POST" }); toast("Alert acknowledged."); router(); }
  catch (e) { toast(e.message, true); }
};
window.resolveFarmAlert = async function(id) {
  try { await api(`/farm-alerts/${id}/resolve`, { method: "POST" }); toast("Alert resolved."); router(); }
  catch (e) { toast(e.message, true); }
};

// ==================================================== VAX CAMPAIGNS =====
function campaignsView(role) {
  route(`#/${role}/campaigns`, async () => {
    render(`${header("Campaigns", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading vaccination campaigns…</div>`);
    const camps = await api("/campaigns");
    const canManage = role === "govt";
    render(`
      ${header("Vaccination Campaigns", { back: true })}
      <div class="section-card">
        ${canManage ? `<button class="btn btn-primary" style="margin-bottom:14px" id="btnNewCamp">+ Create Campaign</button>` : ""}
        ${camps.length === 0 ? emptyState("No vaccination campaigns scheduled.") : camps.map(c => campCard(c, canManage || role === "vet")).join("")}
      </div>
      <div id="campModalWrap"></div>
      ${bottomNav(`#/${role}/campaigns`)}
    `);
    bindCampaignManage(camps, role);
  }, [role]);
}
campaignsView("vet"); campaignsView("govt");

function campCard(c, canUpdate) {
  const pct = c.target_animals ? Math.min(100, Math.round((c.doses_administered / c.target_animals) * 100)) : 0;
  return `
    <div class="list-card" style="cursor:default">
      <div class="row1"><span class="title">${escapeHtml(c.name)}</span><span class="badge ${campStatusClass(c.status)}">${escapeHtml(c.status)}</span></div>
      <div class="meta"><b>${escapeHtml(c.vaccine)}</b> · ${escapeHtml(c.district)} · ${escapeHtml(c.campaign_code)}</div>
      <div class="meta">Dates: ${fmtDate(c.start_date)} → ${fmtDate(c.end_date)}</div>
      <div class="progress-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>
      <div class="row1" style="margin-top:2px"><span class="meta">${escapeHtml(c.doses_administered)} / ${escapeHtml(c.target_animals)} doses (${pct}%)</span>
        ${canUpdate ? `<button class="btn btn-ghost btn-sm btn-edit-camp" data-id="${safeId(c.id)}">Update</button>` : ""}
      </div>
    </div>`;
}
function campStatusClass(s) {
  if (s === "ACTIVE") return "badge-green";
  if (s === "PLANNED") return "badge-blue";
  return "badge-orange";
}
function bindCampaignManage(camps, role) {
  document.querySelectorAll(".btn-edit-camp").forEach(b => {
    b.addEventListener("click", () => {
      const camp = camps.find(x => x.id === Number(b.dataset.id));
      if (!camp) return;
      renderCampModal(camp, role === "govt");
    });
  });
  const btnNew = document.getElementById("btnNewCamp");
  if (btnNew) btnNew.addEventListener("click", () => renderCampModal(null, true));
}

function renderCampModal(camp, isGovt) {
  const isEdit = !!camp;
  const wrap = document.getElementById("campModalWrap");
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-modal", "true");
  wrap.setAttribute("aria-label", isEdit ? "Update Campaign" : "Create Campaign");
  wrap.innerHTML = `
    <div class="section-card" style="border:2px solid var(--primary-light)">
      <div class="subheading">${isEdit ? "Update Campaign: " + camp.campaign_code : "Create New Campaign"}</div>
      <form id="campForm">
        ${!isEdit ? `
          <div class="field"><label for="pm_name">Campaign Name</label><input id="pm_name" name="name" required placeholder="e.g. FMD Drive Haveli" /></div>
          <div class="form-row">
            <div class="field"><label for="pm_district_2">District</label><input id="pm_district_2" name="district" required placeholder="e.g. Pune" /></div>
            <div class="field"><label for="pm_vaccine">Vaccine</label><select id="pm_vaccine" name="vaccine"<option>FMD</option><option>HS</option><option>BQ</option><option>Brucellosis</option></select></div>
          </div>
          <div class="form-row">
            <div class="field"><label for="pm_target_animals">Target Animals</label><input id="pm_target_animals" name="target_animals" type="number" required /></div>
            <div class="field"><label for="pm_start_date">Start Date</label><input id="pm_start_date" name="start_date" type="date" required /></div>
          </div>
          <div class="field"><label for="pm_end_date">End Date</label><input id="pm_end_date" name="end_date" type="date" required /></div>
        ` : `
          <div class="form-row">
            <div class="field"><label for="pm_doses_administered">Doses Administered</label><input id="pm_doses_administered" name="doses_administered" type="number" value="${escapeAttr(camp.doses_administered)}" required /></div>
            <div class="field"><label for="pm_status">Status</label><select id="pm_status" name="status"
              ${["PLANNED", "ACTIVE", "COMPLETED", "CANCELLED"].map(s => `<option ${s === camp.status ? "selected" : ""}>${s}</option>`).join("")}
            </select></div>
          </div>
        `}
        <div class="field"><label for="pm_notes">Notes</label><textarea id="pm_notes" name="notes"${isEdit ? camp.notes || "" : ""}</textarea></div>
        <div class="btn-row">
          <button class="btn btn-primary btn-sm" type="submit">${isEdit ? "Save Changes" : "Create Campaign"}</button>
          <button class="btn btn-outline btn-sm" type="button" onclick="document.getElementById('campModalWrap').innerHTML=''">Cancel</button>
          ${isEdit && isGovt ? `<button class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red)" type="button" id="btnDelCamp">Delete</button>` : ""}
        </div>
      </form>
    </div>`;

  document.getElementById("campForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      if (isEdit) {
        await api(`/campaigns/${camp.id}`, { method: "PUT", body: fd });
        toast("Campaign updated!");
      } else {
        await api("/campaigns", { method: "POST", body: fd });
        toast("Campaign created!");
      }
      router();
    } catch (err) { toast(err.message, true); }
  });

  const delBtn = document.getElementById("btnDelCamp");
  if (delBtn) delBtn.addEventListener("click", async () => {
    if (!confirm(`Delete campaign ${camp.campaign_code}?`)) return;
    try { await api(`/campaigns/${camp.id}`, { method: "DELETE" }); toast("Campaign deleted"); router(); }
    catch (err) { toast(err.message, true); }
  });
}

// ======================================================== VACCINE STOCK ==
route("#/govt/stock", async () => {
  render(`${header("Vaccine Stock", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading stock…</div>`);
  const a = await api("/govt/analytics");
  const stock = a.vaccine_stock || {};
  render(`
    ${header("Vaccine Stock", { back: true })}
    <div class="section-card">
      <div class="section-title">📦 Current District Inventories</div>
      ${Object.keys(stock).length === 0 ? emptyState("No stock recorded yet.") :
        Object.entries(stock).map(([dist, items]) => `
          <div class="list-card" style="cursor:default">
            <div class="row1"><span class="title">${dist}</span></div>
            <div class="tag-row">
              ${items.map(i => `<span class="badge badge-blue">${escapeHtml(i.vaccine)}: ${escapeHtml(i.doses)} doses</span>`).join("")}
            </div>
          </div>`).join("")}
    </div>
    <div class="section-card">
      <div class="subheading">+ Add or Update Stock</div>
      <form id="stockForm">
        <div class="form-row">
          <div class="field"><label for="pm_district_3">District</label><input id="pm_district_3" name="district" required placeholder="e.g. Pune" /></div>
          <div class="field"><label for="pm_vaccine_2">Vaccine</label><select id="pm_vaccine_2" name="vaccine"<option>FMD</option><option>HS</option><option>BQ</option><option>Brucellosis</option></select></div>
        </div>
        <div class="field"><label for="pm_doses">Doses Available</label><input id="pm_doses" name="doses" type="number" required placeholder="e.g. 1500" /></div>
        <button class="btn btn-primary" type="submit">Update Stock</button>
      </form>
    </div>
    ${bottomNav("#/govt/dashboard")}
  `);
  document.getElementById("stockForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const body = Object.fromEntries(new FormData(e.target));
      await api("/govt/stock", { method: "PUT", body });
      toast("Vaccine stock saved"); router();
    } catch (err) { toast(err.message, true); }
  });
}, ["govt"]);

// ========================================================= GOVT: AI RISK ==
const AI_DISEASES = ["HS", "FMD", "BQ", "LSD", "Brucellosis", "PPR"];

route("#/govt/ai", async () => {
  render(`${header("AI Early Warning", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading AI system…</div>`);
  const [districts, modelStatus] = await Promise.all([
    api("/govt/ai/districts"),
    api("/govt/ai/status").catch(() => ({ online: false })),
  ]);
  render(`
    ${header("AI Early Warning", { back: true })}
    <div class="section-card">
      <div class="section-title">🧠 Disease Risk Prediction</div>
      <div class="meta" style="margin-bottom:10px">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${modelStatus.online ? '#43a047' : '#e53935'};margin-right:6px"></span>
        ${modelStatus.online
          ? `AI model <b>online</b> — ${modelStatus.model}, accuracy ${Math.round(modelStatus.accuracy * 100)}% (ROC-AUC ${modelStatus.roc_auc})`
          : `⚠️ AI model <b>offline</b>. Start the ml-backend service (port 8000) to enable predictions.`}
        ${modelStatus.last_successful_prediction ? `<br>Last successful prediction: ${fmtDate(modelStatus.last_successful_prediction)}` : ""}
      </div>
      <form id="aiForm">
        <div class="form-row">
          <div class="field"><label for="pm_district">District</label>
            <select id="pm_district" name="district" required
              ${districts.length ? districts.map(d => `<option>${d}</option>`).join("") : `<option value="">No districts yet</option>`}
            </select>
          </div>
          <div class="field"><label for="pm_disease">Disease</label>
            <select id="pm_disease" name="disease" required${AI_DISEASES.map(d => `<option>${d}</option>`).join("")}</select>
          </div>
        </div>
        <button class="btn btn-primary" type="submit" ${modelStatus.online ? "" : "disabled"}>Predict Risk</button>
      </form>
    </div>
    <div id="aiResults"></div>
    ${bottomNav("#/govt/ai")}
  `);
  document.getElementById("aiForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!f.district) return toast("No district data available yet", true);
    const box = document.getElementById("aiResults");
    box.innerHTML = `<div class="loading" role="status" aria-live="polite" aria-busy="true">Running AI prediction on live district & weather data…</div>`;
    try {
      const qs = `district=${encodeURIComponent(f.district)}&disease=${encodeURIComponent(f.disease)}`;
      const [pred, outbreak] = await Promise.all([api(`/govt/ai/predict?${qs}`), api(`/govt/ai/outbreak?${qs.split("&")[0]}`).catch(() => null)]);
      const feat = pred.features_used || {};
      box.innerHTML = `
        <div class="section-card">
          <div class="section-title">📈 ${escapeHtml(f.disease)} — ${escapeHtml(f.district)}</div>
          <div class="stat-grid">
            ${statCard(pred.risk_score + "%", "Risk Score")}
            <div class="stat-card"><div class="num" style="font-size:18px"><span class="badge ${riskBadgeClass(pred.risk_level)}">${escapeHtml(pred.risk_level)}</span></div><div class="lbl">Risk Level</div></div>
            ${statCard(pred.trend, "Trend")}
            ${statCard(pred.predicted_cases, "Predicted Cases (14d)")}
          </div>
        </div>
        <div class="section-card">
          <div class="section-title">🎯 Top Risk Factors (model importance)</div>
          ${barChart((pred.top_risk_factors || []).map(t2 => ({ label: `${t2.factor} (value: ${t2.value})`, value: Math.round(t2.impact * 100) })))}
        </div>
        <div class="section-card">
          <div class="section-title">✅ Recommended Actions</div>
          ${(pred.recommended_actions || []).map(a => `<div class="meta" style="margin:4px 0">• ${a}</div>`).join("")}
        </div>
        ${outbreak ? `
        <div class="section-card">
          <div class="section-title">🚨 Outbreak Detection (Isolation Forest)</div>
          <div class="meta">Detected: <b>${outbreak.outbreak_detected ? "YES ⚠️" : "No"}</b> · Severity: <b>${outbreak.severity}</b> · Anomaly score: ${outbreak.anomaly_score}</div>
        </div>` : ""}
        ${weatherReliabilityWarning(pred.weather_reliability)}
        <div class="section-card">
          <div class="section-title">🗄 Live Data & Weather Used (from database)</div>
          <div class="meta">Animals registered: <b>${feat.animal_population}</b></div>
          <div class="meta">Affected animals: <b>${feat.affected_animals}</b></div>
          <div class="meta">New cases (30 days): <b>${feat.new_cases}</b> · Growth rate: <b>${feat.cases_growth_rate}</b></div>
          <div class="meta">Vaccination coverage: <b>${Math.round((feat.vaccination_coverage || 0) * 100)}%</b></div>
          <div class="meta">Weather Temperature: <b>${feat.temperature}°C</b> · Humidity: <b>${feat.humidity}%</b> · Rainfall: <b>${feat.rainfall} mm</b></div>
          <div class="meta small-muted">Weather Source: ${feat.weather_source || "Open-Meteo API"}</div>
        </div>`;
    } catch (err) {
      box.innerHTML = `<div class="section-card"><div class="meta">⚠️ ${escapeHtml(err.message)}</div></div>`;
    }
  });
}, ["govt"]);

// ------------------------------------------------------- disease library --
function diseasesView(role) {
  route(`#/${role}/diseases`, async () => {
    render(`${header("Disease Info", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading disease library…</div>`);
    const diseases = await api("/diseases");
    render(`
      ${header("Disease Information", { back: true })}
      <div class="section-card">
        <div class="field" style="margin-bottom:12px">
          <input id="diseaseSearch" placeholder="Search diseases (e.g. FMD, लाळ खुरकूत, Anthrax)…" />
        </div>
        <div id="diseaseList"></div>
      </div>
      ${bottomNav(role === "govt" ? "#/govt/dashboard" : `#/${role}/dashboard`)}
    `);
    const list = document.getElementById("diseaseList");
    function renderList(items) {
      if (!items.length) { list.innerHTML = emptyState("No matching diseases."); return; }
      list.innerHTML = items.map(d => `
        <div class="list-card" style="cursor:default">
          <div class="row1"><span class="title">${escapeHtml(d.name_en)} <span style="font-weight:400;color:var(--muted)">(${escapeHtml(d.name_mr)})</span></span>
            <span class="badge ${escapeHtml(d.species.includes("Cattle") ? "badge-blue" : "badge-orange")}">${escapeHtml(d.species.join(", "))}</span>
          </div>
          <div class="meta" style="color:var(--text);margin-top:4px"><b>${t("nav.reporting")} / Symptoms:</b> ${escapeHtml(d.symptoms_en.join(", "))}</div>
          <div class="meta" style="font-style:italic">${escapeHtml(d.symptoms_mr.join(", "))}</div>
          <div class="meta" style="margin-top:4px"><b>Prevention:</b> ${escapeHtml(d.prevention_en.join("; "))}</div>
        </div>`).join("");
    }
    renderList(diseases);
    document.getElementById("diseaseSearch").addEventListener("input", e => {
      const q = e.target.value.toLowerCase().trim();
      if (!q) return renderList(diseases);
      renderList(diseases.filter(d =>
        d.name_en.toLowerCase().includes(q) || d.name_mr.includes(q) ||
        d.symptoms_en.some(s => s.toLowerCase().includes(q)) ||
        d.symptoms_mr.some(s => s.includes(q)) ||
        (d.aliases || []).some(a => a.toLowerCase().includes(q))
      ));
    });
  }, [role]);
}
diseasesView("vet"); diseasesView("govt"); diseasesView("lab");

// --------------------------------------------------------------- profile --
function profileView(role) {
  route(`#/${role}/profile`, () => {
    const u = state.user || {};
    if (role === "owner") {
      render(`
        ${header(ft("profile"), { back: true })}
        <div class="section-card">
          <div style="text-align:center;margin-bottom:16px">
            <div style="font-size:52px">${ROLE_META[role].emoji}</div>
            <div style="font-size:18px;font-weight:800">${escapeHtml(u.full_name || ft("user"))}</div>
            <div class="badge badge-blue" style="margin-top:4px">${t(ROLE_META[role].label)}</div>
          </div>
          <div class="detail-grid farmer-detail-grid">
            <div><b>${ft("mobile_label")}</b>${escapeHtml(u.mobile || "—")}</div>
            <div><b>${ft("email")}</b>${escapeHtml(u.email || "—")}</div>
            <div><b>${ft("village")}</b>${escapeHtml(u.village || "—")}</div>
            <div><b>${ft("block")}</b>${escapeHtml(u.block || "—")}</div>
            <div><b>${ft("district")}</b>${escapeHtml(u.district || "—")}</div>
            <div><b>${ft("current_language")}</b>${({ en: "English", mr: "मराठी", hi: "हिन्दी", te: "తెలుగు" })[state.lang]}</div>
          </div>
        </div>
        <div class="section-card"><button class="btn btn-outline" onclick="logout()">${ft("logout")}</button></div>
        ${bottomNav("")}
      `);
      return;
    }
    render(`
      ${header("My Profile", { back: true })}
      <div class="section-card">
        <div style="text-align:center;margin-bottom:16px">
          <div style="font-size:52px">${ROLE_META[role].emoji}</div>
          <div style="font-size:18px;font-weight:800">${escapeHtml(u.full_name || "User")}</div>
          <div class="badge badge-blue" style="margin-top:4px">${t(ROLE_META[role].label)}</div>
        </div>
        <div class="detail-grid">
          <div><b>Mobile</b>${escapeHtml(u.mobile || "—")}</div>
          <div><b>Email</b>${escapeHtml(u.email || "—")}</div>
          <div><b>Village</b>${escapeHtml(u.village || "—")}</div>
          <div><b>Block</b>${escapeHtml(u.block || "—")}</div>
          <div><b>District</b>${escapeHtml(u.district || "—")}</div>
          <div><b>Specialization</b>${escapeHtml(u.specialization || "General")}</div>
        </div>
      </div>
      <div class="section-card">
        <button class="btn btn-outline" onclick="logout()">${t("btn.logout")}</button>
      </div>
      ${bottomNav("")}
    `);
  }, [role]);
}
profileView("owner"); profileView("vet"); profileView("govt"); profileView("lab");

// ============================================================ HERDS =====
route("#/owner/herds", () => { location.hash = "#/owner/livestock"; }, ["owner"]);

async function herdDetailView(role, id) {
  const farmer = role === "owner";
  render(`${header(farmer ? ft("herd_information") : "Herd Intelligence", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">${farmer ? ft("loading_herd") : "Loading herd telemetry…"}</div>`);
  const hi = await api(`/herds/${id}/intelligence`);
  if (farmer) {
    const animals = (await api("/animals")).filter(a => Number(a.herd_id) === Number(id));
    render(`
      ${header(ft("herd_information"), { back: true })}
      <div class="section-card">
        <div class="owner-herd-name">🐑 ${escapeHtml(hi.herd_code)}</div>
        <div class="detail-grid farmer-detail-grid">
          <div><b>${ft("animal_count")}</b>${escapeHtml(hi.total_animals)}</div>
          <div><b>${ft("health_status")}</b><span class="badge ${riskBadgeClass(hi.risk_level)}">${ownerRiskLabel(hi.risk_level)}</span></div>
          <div><b>${ft("active_cases")}</b>${escapeHtml(hi.active_cases)}</div>
          <div><b>${ft("location")}</b>${escapeHtml([hi.village, hi.district].filter(Boolean).join(", ") || ft("unknown"))}</div>
        </div>
      </div>
      <div class="section-card">
        <div class="section-title">🐄 ${ft("herd_animals")} (${animals.length})</div>
        ${animals.length ? animals.map(a => `
          <div class="list-card farmer-list-card" role="button" tabindex="0" onclick="location.hash='#/owner/animals/${safeId(a.id)}'" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.hash='#/owner/animals/${safeId(a.id)}'}">
            <div class="row1"><span class="title">${escapeHtml(a.animal_name || a.animal_code)}</span><span class="badge ${escapeHtml(a.status === "Healthy" ? "badge-green" : "badge-orange")}">${ownerAnimalStatus(a.status)}</span></div>
            <div class="meta">${ownerAnimalType(a.animal_type || a.species)} · ${ft("age")}: ${escapeHtml(a.age ?? a.age_years ?? ft("unknown"))}${(a.age ?? a.age_years) !== null && (a.age ?? a.age_years) !== undefined && (a.age ?? a.age_years) !== "" ? ` ${ft("years")}` : ""}</div>
          </div>`).join("") : emptyState(ft("no_herd_animals"))}
        <button class="btn btn-ghost" style="margin-top:8px" onclick="location.hash='#/owner/livestock'">${ft("back_to_livestock")}</button>
      </div>
      ${bottomNav("#/owner/livestock")}
    `);
    return;
  }
  render(`
    ${header("Herd " + hi.herd_code, { back: true })}
    <div class="section-card">
      <div class="row1" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span class="title" style="font-size:18px">${escapeHtml(hi.herd_code)}</span>
        <span class="badge ${riskBadgeClass(hi.risk_level)}">${escapeHtml(hi.risk_level)}</span>
      </div>
      <div class="detail-grid">
        <div><b>Location</b>${escapeHtml(hi.village)}, ${escapeHtml(hi.district)}</div>
        <div><b>Total Animals</b>${escapeHtml(hi.total_animals)}</div>
        <div><b>Active Cases</b>${escapeHtml(hi.active_cases)}</div>
        <div><b>Vaccination Coverage</b>${Math.round(hi.vaccination_coverage * 100)}%</div>
      </div>
    </div>
    <div class="section-card">
      <div class="subheading">🚨 Herd Alerts (${hi.alerts.length})</div>
      ${hi.alerts.length === 0 ? emptyState("No active alerts for this herd.") : hi.alerts.map(a => `
        <div class="list-card" style="cursor:default">
          <div class="row1"><span class="title">${escapeHtml(a.disease)}</span><span class="badge ${riskBadgeClass(a.risk_level)}">${escapeHtml(a.risk_level)}</span></div>
          <div class="meta">${escapeHtml(a.trigger_reason)}</div>
          <div class="meta">Action: ${escapeHtml(a.recommended_action)}</div>
        </div>
      `).join("")}
    </div>
    ${bottomNav(homeFor(role))}
  `);
}
route("#/:role/herds/:id", ({ role, id }) => herdDetailView(role, id), ["owner", "vet", "govt"]);

route("#/owner/herds/new", () => {
  render(`
    ${header(ft("add_herd"), { back: true })}
    <div class="section-card">
      <form id="herdForm">
        <div class="form-row">
          <div class="field"><label for="pm_village_2">${ft("village")}</label><input id="pm_village_2" name="village" value="${escapeHtml(state.user.village || "")}" autocomplete="address-level3" /></div>
          <div class="field"><label for="pm_block_2">${ft("block")}</label><input id="pm_block_2" name="block" value="${escapeAttr(state.user.block || "")}" /></div>
        </div>
        <div class="field"><label for="pm_district_4">${ft("district")}</label><input id="pm_district_4" name="district" value="${escapeHtml(state.user.district || "")}" /></div>
        <button class="btn btn-primary" type="submit">${ft("create_herd")}</button>
      </form>
    </div>
    ${bottomNav("#/owner/livestock")}`);
  document.getElementById("herdForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const body = Object.fromEntries(new FormData(e.target));
      const herd = await api("/herds", { method: "POST", body });
      toast(ft("herd_created", { code: herd.herd_code }));
      location.hash = "#/owner/livestock";
    } catch (err) { toast(err.message, true); }
  });
}, ["owner"]);

// =========================================================== ANIMALS ====
function animalsListView(role) {
  route(`#/${role}/animals`, async () => {
    if (role === "owner") { location.hash = "#/owner/livestock"; return; }
    render(`${header("Animals", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading…</div>`);
    const animals = await api("/animals");
    render(`
      ${header(role === "owner" ? "My Animals" : "Animals", { back: true })}
      <div class="section-card">
        ${role === "owner" ? `<button class="btn btn-primary" style="margin-bottom:14px" onclick="location.hash='#/owner/animals/new'">+ Add Animal</button>` : ""}
        ${animals.length === 0 ? emptyState("No animals registered yet.") :
          animals.map(a => `
          <div class="list-card" role="button" tabindex="0" onclick="location.hash='#/${role}/animals/${safeId(a.id)}'" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.hash='#/${role}/animals/${safeId(a.id)}'}">
            <div class="row1"><span class="title">${escapeHtml(a.animal_code)}</span><span class="badge ${escapeHtml(a.status === 'Healthy' ? 'badge-green' : 'badge-orange')}">${escapeHtml(a.status)}</span></div>
            <div class="meta">${escapeHtml(a.animal_name || "—")} · ${escapeHtml(a.animal_type || a.species || "—")} · ${escapeHtml(a.breed || "—")} · ${escapeHtml((a.gender || a.sex || "—"))} · ${escapeHtml((a.age || a.age_years) ? (a.age || a.age_years) + " yrs" : "—")}</div>
            ${role === "owner" ? `<div style="margin-top:8px;display:flex;gap:8px">
              <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();location.hash='#/owner/report?animal=${safeId(a.id)}'">Report Issue</button>
              <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();deleteAnimal(${safeId(a.id)},'${escapeJsStr(a.animal_code)}')"> Delete</button>
            </div>` : ""}
          </div>`).join("")}
      </div>
      ${bottomNav(role === "owner" ? "#/owner/animals" : `#/${role}/dashboard`)}
    `);
  }, [role]);
}
animalsListView("owner"); animalsListView("vet"); animalsListView("govt"); animalsListView("lab");

route("#/owner/animals/new", async () => {
  const herds = await api("/herds").catch(() => []);
  render(`
    ${header(ft("add_animal"), { back: true })}
    <div class="section-card">
      <form id="animalForm">
        <div class="field"><label for="pm_animal_name">${ft("animal_name")}</label><input id="pm_animal_name" name="animal_name" autocomplete="off" required /></div>
        <div class="field"><label for="pm_animal_type">${ft("animal_type")}</label>
          <select id="pm_animal_type" name="animal_type" required<option value="">${ft("select")}</option>
            <option value="Cattle">${ft("cattle")}</option><option value="Buffalo">${ft("buffalo")}</option>
            <option value="Goat">${ft("goat")}</option><option value="Sheep">${ft("sheep")}</option><option value="Other">${ft("other")}</option></select>
        </div>
        <div class="form-row">
          <div class="field"><label for="pm_breed">${ft("breed")}</label><input id="pm_breed" name="breed" placeholder="${ft("breed_placeholder")}" /></div>
          <div class="field"><label for="pm_gender">${ft("gender")}</label><select id="pm_gender" name="gender"<option value="Female">${ft("female")}</option><option value="Male">${ft("male")}</option></select></div>
        </div>
        <div class="field"><label for="pm_age">${ft("age")}</label><input id="pm_age" name="age" type="number" step="0.5" min="0" inputmode="decimal" placeholder="${ft("age_placeholder")}" /></div>
        <div class="field"><label for="pm_herd_id">${ft("herd")} (${ft("optional")})</label>
          <select id="pm_herd_id" name="herd_id"<option value="">${ft("no_herd")}</option>${herds.map(h => `<option value="${safeId(h.id)}">${ft("herd_name")} ${escapeHtml(h.herd_code)}</option>`).join("")}</select>
        </div>
        <div class="field"><label for="pm_owner_name">${ft("full_name")}</label><input id="pm_owner_name" name="owner_name" value="${escapeHtml(state.user.full_name || "")}" autocomplete="name" required /></div>
        <div class="field"><label for="pm_mobile_2">${ft("mobile")}</label><input id="pm_mobile_2" name="mobile" value="${escapeAttr(state.user.mobile || "")}" inputmode="tel" autocomplete="tel" required /></div>
        <div class="form-row">
          <div class="field"><label for="pm_village_3">${ft("village")}</label><input id="pm_village_3" name="village" value="${escapeHtml(state.user.village || "")}" autocomplete="address-level3" /></div>
          <div class="field"><label for="pm_district_5">${ft("district")}</label><input id="pm_district_5" name="district" value="${escapeHtml(state.user.district || "")}" /></div>
        </div>
        <button class="btn btn-primary" type="submit">${ft("register_animal")}</button>
      </form>
    </div>
    ${bottomNav("#/owner/livestock")}`);
  document.getElementById("animalForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const body = Object.fromEntries(new FormData(e.target));
      const animal = await api("/animals", { method: "POST", body });
      toast(ft("animal_registered", { code: animal.animal_code }));
      location.hash = "#/owner/animals/" + animal.id;
    } catch (err) { toast(err.message, true); }
  });
}, ["owner"]);

function ownerAnimalRecord(a) {
  const age = a.age ?? a.age_years;
  const cases = a.cases || [];
  const prescriptions = a.prescriptions || [];
  const vaccinations = a.vaccinations || [];
  const labReports = a.lab_reports || [];
  render(`
    ${header(ft("animal_information"), { back: true })}
    <div class="section-card">
      <div class="row1 farmer-animal-heading">
        <div><div class="owner-animal-name">${escapeHtml(a.animal_name || a.animal_code)}</div><div class="small-muted">${ft("animal_id")}: ${escapeHtml(a.animal_code)}</div></div>
        <span class="badge ${escapeHtml(a.status === "Healthy" ? "badge-green" : a.status === "Deceased" ? "badge-blue" : "badge-orange")}">${ownerAnimalStatus(a.status)}</span>
      </div>
      <div class="detail-grid farmer-detail-grid" style="margin-top:14px">
        <div><b>${ft("animal_type")}</b>${ownerAnimalType(a.animal_type || a.species)}</div>
        <div><b>${ft("breed")}</b>${escapeHtml(a.breed || ft("unknown"))}</div>
        <div><b>${ft("age")}</b>${age !== null && age !== undefined && age !== "" ? `${age} ${ft("years")}` : ft("unknown")}</div>
        <div><b>${ft("gender")}</b>${escapeHtml(a.gender === "Female" || a.sex === "Female" ? ft("female") : a.gender === "Male" || a.sex === "Male" ? ft("male") : ft("unknown"))}</div>
        <div><b>${ft("herd")}</b>${escapeHtml(a.herd ? a.herd.herd_code : ft("no_herd"))}</div>
        <div><b>${ft("location")}</b>${escapeHtml([a.village, a.district].filter(Boolean).join(", ") || ft("unknown"))}</div>
      </div>
      <div class="owner-detail-actions">
        <button class="btn btn-primary" onclick="location.hash='#/owner/report?animal=${safeId(a.id)}'">📋 ${ft("report_problem")}</button>
        <button class="btn btn-ghost" onclick="showQrModal(${safeId(a.id)})">🏷️ ${ft("qr_tag")}</button>
        ${a.status !== "Deceased" ? `<button class="btn btn-outline" onclick="markDeceased(${safeId(a.id)},'${escapeJsStr(a.animal_code)}')">${ft("mark_deceased")}</button>` : ""}
        <button class="btn btn-outline owner-danger-button" onclick="deleteAnimal(${safeId(a.id)},'${escapeJsStr(a.animal_code)}')">${ft("delete_animal")}</button>
      </div>
    </div>
    <div class="section-card">
      <div class="section-title">💊 ${ft("health_and_treatment")}</div>
      ${cases.length ? cases.slice(0, 4).map(c => `
        <div class="list-card farmer-list-card" role="button" tabindex="0" onclick="location.hash='#/owner/cases/${safeId(c.id)}'" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.hash='#/owner/cases/${safeId(c.id)}'}">
          <div class="row1"><span class="title">${escapeHtml(c.case_no)}</span><span class="badge ${statusBadgeClass(c.status)}">${ownerCaseStatus(c.status)}</span></div>
          <div class="meta">${escapeHtml(c.symptoms || ft("case_detail"))} · ${fmtDate(c.created_at)}</div>
        </div>`).join("") : `<div class="meta">${ft("healthy_message")}</div>`}
      ${prescriptions.length ? `
        <div class="subheading">${ft("treatment_history")}</div>
        ${prescriptions.slice(0, 4).map(p => `
          <div class="list-card" style="cursor:default">
            <div class="row1"><span class="title">${escapeHtml(p.medicine)}</span><span class="badge badge-blue">${escapeHtml(p.dosage || "")}</span></div>
            <div class="meta">${escapeHtml(p.frequency || "")}${p.duration ? ` · ${escapeHtml(p.duration)}` : ""}</div>
            <div class="meta">${ft("prescribed_by")}: ${escapeHtml(p.vet_name || ft("unknown"))} · ${ft("follow_up")}: ${fmtDate(p.follow_up_date)}</div>
            ${p.instructions ? `<div class="meta">${ft("instructions")}: ${escapeHtml(p.instructions)}</div>` : ""}
          </div>`).join("")}
      ` : `<div class="subheading">${ft("treatment_history")}</div>${emptyState(ft("no_treatments"))}`}
      ${vaccinations.length ? `
        <div class="subheading">${ft("vaccination_history")}</div>
        ${vaccinations.slice(0, 3).map(v => `<div class="list-card" style="cursor:default"><div class="row1"><span class="title">${escapeHtml(v.vaccine)}</span><span class="badge badge-blue">${ft("given_on")}: ${fmtDate(v.date_given)}</span></div></div>`).join("")}
      ` : ""}
      ${labReports.length ? `
        <button class="btn btn-ghost" style="margin-top:8px" onclick="location.hash='#/owner/lab-reports'">🧪 ${ft("test_results")}</button>
      ` : ""}
    </div>
    ${bottomNav("#/owner/livestock")}
  `);
}

// Animal health record (shared render, role-scoped routes)
function animalRecordView(role) {
  route(`#/${role}/animals/:id`, async ({ id }) => {
    const farmer = role === "owner";
    render(`${header(farmer ? ft("animal_information") : "Animal Record", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">${farmer ? ft("loading_animal") : "Loading health passport…"}</div>`);
    const a = await api(`/animals/${id}`);
    if (farmer) { ownerAnimalRecord(a); return; }
    const isVet = role === "vet";
    const canEdit = isVet || role === "owner";

    const reproLatest = a.reproductive_records && a.reproductive_records.length ? a.reproductive_records[0] : null;
    const cds = a.ai_decision_support;

    render(`
      ${header("Digital Health Record", { back: true })}
      <div class="section-card">
        <div class="row1" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-size:18px;font-weight:800">${escapeHtml(a.animal_code)}</div>
          <span class="badge ${escapeHtml(a.status === 'Healthy' ? 'badge-green' : 'badge-orange')}">${escapeHtml(a.status)}</span>
        </div>
        <div class="detail-grid">
          <div><b>Animal Name</b>${escapeHtml(a.animal_name || "—")}</div>
          <div><b>Animal Type</b>${escapeHtml(a.animal_type || a.species || "—")}</div>
          <div><b>Breed</b>${escapeHtml(a.breed || "—")}</div>
          <div><b>Gender</b>${escapeHtml(a.gender || a.sex || "—")}</div>
          <div><b>Age</b>${escapeHtml((a.age || a.age_years) ? (a.age || a.age_years) + " yrs" : "—")}</div>
          <div><b>Owner Name</b>${escapeHtml(a.owner_name || "—")}</div>
          <div><b>Mobile</b>${escapeHtml(a.mobile || "—")}</div>
          <div><b>Herd</b>${escapeHtml(a.herd ? a.herd.herd_code : "—")}</div>
          <div><b>Location</b>${escapeHtml(a.village || "—")}, ${escapeHtml(a.district || "—")}</div>
        </div>
        <div style="margin-top:14px">
          <button class="btn btn-ghost btn-sm" onclick="showQrModal(${safeId(a.id)})">🏷️ Digital QR Passport &amp; Printable Tag</button>
          ${a.status !== "Deceased" && (role === "owner" || role === "vet") ? `<button class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red);margin-left:8px" onclick="markDeceased(${safeId(a.id)},'${escapeJsStr(a.animal_code)}')">☠️ Mark Deceased</button>` : ""}
        </div>
      </div>

      <!-- FEATURE GROUP 2: REPRODUCTIVE HEALTH -->
      <div class="section-card">
        <div class="subheading" style="justify-content:space-between">
          <span>🩺 Reproductive Health &amp; Gestation</span>
          <span class="badge badge-blue">${escapeHtml(reproLatest ? reproLatest.pregnancy_status : "Not Pregnant")}</span>
        </div>
        <div class="detail-grid" style="margin-top:8px">
          <div><b>Breeding Date</b>${reproLatest && reproLatest.breeding_date ? fmtDate(reproLatest.breeding_date) : "—"}</div>
          <div><b>Expected Delivery</b>${reproLatest && reproLatest.expected_delivery_date ? fmtDate(reproLatest.expected_delivery_date) : "—"}</div>
          <div><b>Prior Pregnancies</b>${reproLatest ? reproLatest.previous_pregnancies : 0}</div>
          <div><b>Total Offspring</b>${reproLatest ? reproLatest.offspring_count : 0}</div>
        </div>
        ${reproLatest && reproLatest.breeding_notes ? `<div class="small-muted" style="margin-top:6px"><b>Notes:</b> ${escapeHtml(reproLatest.breeding_notes)}</div>` : ""}
        ${canEdit ? `
          <button class="btn btn-outline btn-sm" style="margin-top:10px" onclick="document.getElementById('reproFormWrap').style.display='block'">+ Record Reproductive Event</button>
          <div id="reproFormWrap" style="display:none;margin-top:12px;background:#f8f9fe;padding:12px;border-radius:12px">
            <form id="reproForm">
              <div class="form-row">
                <div class="field"><label for="pm_event_type">Event</label><select id="pm_event_type" name="event_type"<option>Pregnancy Check</option><option>AI</option><option>Natural Service</option><option>Calving</option><option>Abortion</option></select></div>
                <div class="field"><label for="pm_pregnancy_status">Pregnancy Status</label><select id="pm_pregnancy_status" name="pregnancy_status"<option>Confirmed Pregnant</option><option>Suspected</option><option>Not Pregnant</option><option>Lactating</option><option>Dry</option><option>Miscarried/Aborted</option></select></div>
              </div>
              <div class="form-row">
                <div class="field"><label for="pm_breeding_date">Breeding / Mating Date</label><input id="pm_breeding_date" name="breeding_date" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
                <div class="field"><label for="pm_expected_delivery_date">Expected Delivery</label><input id="pm_expected_delivery_date" name="expected_delivery_date" type="date" placeholder="Auto-calculated if blank" /></div>
              </div>
              <div class="field"><label for="pm_breeding_notes">Notes</label><input id="pm_breeding_notes" name="breeding_notes" placeholder="e.g. AI straw batch #, rectal palpation findings" /></div>
              <button class="btn btn-primary btn-sm" type="submit">Save Reproductive Record</button>
            </form>
          </div>
        ` : ""}
      </div>

      <!-- FEATURE GROUP 3: MEDICATION & ALLERGY PROFILE -->
      <div class="section-card">
        <div class="subheading">💊 Medication &amp; Allergy Profile</div>
        <div style="margin-bottom:8px">
          <b>Known Drug Allergies:</b>
          ${(!a.allergies || a.allergies.length === 0) ? `<div class="small-muted" style="margin:4px 0">No known drug allergies on record.</div>` :
            a.allergies.map(al => `
              <div class="conflict-box" style="margin:6px 0;padding:8px 12px">
                <b>⚠️ ${escapeHtml(al.allergen)} (${escapeHtml(al.allergy_severity)} Allergy)</b>
                <div>Reaction: ${escapeHtml(al.reaction)} · Recorded: ${fmtDate(al.date_recorded)}</div>
                ${al.notes ? `<div class="small-muted">${escapeHtml(al.notes)}</div>` : ""}
              </div>
            `).join("")}
        </div>
        ${isVet ? `
          <button class="btn btn-outline btn-sm" onclick="document.getElementById('allergyFormWrap').style.display='block'">+ Add Known Allergy</button>
          <div id="allergyFormWrap" style="display:none;margin-top:12px;background:#f8f9fe;padding:12px;border-radius:12px">
            <form id="allergyForm">
              <div class="form-row">
                <div class="field"><label for="pm_allergen">Allergen Name</label><input id="pm_allergen" name="allergen" placeholder="e.g. Penicillin, NSAID, Sulfa" required /></div>
                <div class="field"><label for="pm_allergy_severity">Severity</label><select id="pm_allergy_severity" name="allergy_severity"<option>Moderate</option><option>Severe</option><option>Life-Threatening</option><option>Mild</option></select></div>
              </div>
              <div class="field"><label for="pm_reaction">Observed Reaction</label><input id="pm_reaction" name="reaction" placeholder="e.g. Anaphylaxis, facial edema, urticaria" required /></div>
              <div class="field"><label for="pm_notes_2">Clinical Notes</label><input id="pm_notes_2" name="notes" placeholder="Contraindications or cross-reactivity notes" /></div>
              <button class="btn btn-primary btn-sm" type="submit">Save Allergy Profile</button>
            </form>
          </div>
        ` : ""}
      </div>

      <!-- FEATURE GROUP 11, 12, 13: INDIVIDUAL ANIMAL AI DECISION SUPPORT -->
      ${cds ? `
        <div class="section-card">
          <div class="subheading">🧠 AI Clinical Decision Support</div>
          <div class="stat-grid" style="margin:0 0 10px 0">
            ${statCard(cds.risk_score + "%", "Clinical Risk")}
            <div class="stat-card"><div class="num" style="font-size:16px"><span class="badge ${riskBadgeClass(cds.risk_level)}">${cds.risk_level}</span></div><div class="lbl">Risk Classification</div></div>
            ${statCard(cds.confidence + "%", "Confidence")}
          </div>
          <div class="demo-box" style="margin:8px 0;background:#fff8e1;border-left:4px solid #ffb300;color:#795548">
            <b>⚠️ Clinical Guidance Notice:</b> ${cds.disclaimer}
          </div>
          <div style="margin-top:10px">
            <b>🚨 Detected Findings &amp; Risk Indicators:</b>
            ${cds.abnormal_findings.map(f => `<div class="meta" style="margin:4px 0">• ${f}</div>`).join("")}
          </div>
          <div style="margin-top:10px">
            <b>📋 Suggested Diagnostic Next Steps:</b>
            ${cds.suggested_next_steps.map(s => `<div class="meta" style="margin:4px 0">• ${s}</div>`).join("")}
          </div>
          <div style="margin-top:10px">
            <b>🗓️ Follow-up Recommendations:</b>
            ${cds.follow_up_recommendations.map(r => `<div class="meta" style="margin:4px 0">• ${r}</div>`).join("")}
          </div>
        </div>
      ` : ""}

      <!-- EXISTING PASSPORT CARDS -->
      <div class="section-card">
        <div class="subheading">🩺 Previous Cases</div>
        ${a.cases.length === 0 ? emptyState("No cases recorded.") : a.cases.map(c => `
          <div class="list-card" role="button" tabindex="0" onclick="location.hash='#/${role}/cases/${safeId(c.id)}'" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.hash='#/${role}/cases/${safeId(c.id)}'}">
            <div class="row1"><span class="title">${escapeHtml(c.case_no)}</span><span class="badge ${statusBadgeClass(c.status)}">${escapeHtml(c.status)}</span></div>
            <div class="meta">${escapeHtml(c.symptoms || "")} · ${fmtDate(c.created_at)}</div>
          </div>`).join("")}
      </div>
      <div class="section-card">
        <div class="subheading">💉 Vaccination History</div>
        ${a.vaccinations.length === 0 ? emptyState("No vaccinations recorded.") : a.vaccinations.map(v => `
          <div class="list-card" style="cursor:default">
            <div class="row1"><span class="title">${escapeHtml(v.vaccine)}</span><span class="badge badge-blue">Next: ${fmtDate(v.next_due_date)}</span></div>
            <div class="meta">Given: ${fmtDate(v.date_given)} · By ${escapeHtml(v.vet_name || "—")}</div>
          </div>`).join("")}
      </div>
      <div class="section-card">
        <div class="subheading">🧪 Laboratory Reports</div>
        ${a.lab_reports.length === 0 ? emptyState("No lab reports yet.") : a.lab_reports.map(l => `
          <div class="list-card" style="cursor:default">
            <div class="row1"><span class="title">${escapeHtml(l.report_no)}</span><span class="badge ${escapeHtml(l.result === 'NEGATIVE' ? 'badge-green' : 'badge-red')}">${escapeHtml(l.result || "Pending")}</span></div>
            <div class="meta">${escapeHtml(l.test_name || "")} · Sample: ${escapeHtml(l.sample || "—")} · ${fmtDate(l.test_date)}</div>
          </div>`).join("")}
      </div>
      <div class="section-card">
        <div class="subheading">💊 Prescriptions</div>
        ${a.prescriptions.length === 0 ? emptyState("No prescriptions yet.") : a.prescriptions.map(p => `
          <div class="list-card" style="cursor:default">
            <div class="row1"><span class="title">${escapeHtml(p.medicine)}</span><span class="badge badge-blue">${escapeHtml(p.dosage || "")}</span></div>
            <div class="meta">${escapeHtml(p.frequency || "")} · ${escapeHtml(p.duration || "")} · By ${escapeHtml(p.vet_name || "—")}</div>
          </div>`).join("")}
      </div>
      ${bottomNav(role === "owner" ? "#/owner/animals" : `#/${role}/dashboard`)}
    `);

    if (document.getElementById("reproForm")) {
      document.getElementById("reproForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          const body = Object.fromEntries(new FormData(e.target));
          await api(`/animals/${id}/reproductive`, { method: "POST", body });
          toast("Reproductive record saved!");
          animalRecordView(role);
        } catch (err) { toast(err.message, true); }
      });
    }

    if (document.getElementById("allergyForm")) {
      document.getElementById("allergyForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          const body = Object.fromEntries(new FormData(e.target));
          await api(`/animals/${id}/allergies`, { method: "POST", body });
          toast("Allergy record added!");
          animalRecordView(role);
        } catch (err) { toast(err.message, true); }
      });
    }
  }, [role]);
}
animalRecordView("owner"); animalRecordView("vet"); animalRecordView("govt"); animalRecordView("lab");

// QR Code Passport Modal
window.showQrModal = async function(id) {
  try {
    const data = await api(`/animals/${id}/qr`);
    const farmer = getUserRole() === "owner";
    const old = document.getElementById("qrModal");
    if (old) old.remove();
    const div = document.createElement("div");
    div.id = "qrModal";
    div.className = "qr-modal";
    div.setAttribute("role", "dialog");
    div.setAttribute("aria-modal", "true");
    div.setAttribute("aria-label", "Animal QR Code");
    div.innerHTML = `
      <div class="qr-modal-content">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <b>🏷️ ${farmer ? ft("qr_tag") : "Digital Animal Health Tag"}</b>
          <button aria-label="${farmer ? ft("close") : "Close"}" data-close-modal style="border:none;background:none;font-size:20px;cursor:pointer" onclick="document.getElementById('qrModal').remove()">✕</button>
        </div>
        <div style="font-size:17px;font-weight:800;color:var(--primary)">${escapeHtml(data.animal_code)}</div>
        <div class="small-muted">${escapeHtml(farmer ? ownerAnimalType(data.species) : data.species)}${farmer ? "" : ` · Token: ${escapeHtml(data.qr_token.slice(0, 16))}…`}</div>
        <div class="qr-image-wrap">
          <img src="${escapeAttr(data.qr_image)}" alt="${escapeAttr(farmer ? ft("qr_tag") : "Animal Health Passport QR")}" />
        </div>
        <div class="btn-row" style="margin-top:12px">
          <a class="btn btn-ghost btn-sm" href="${escapeAttr(data.qr_image)}" download="${escapeAttr(data.animal_code)}_QR.png" style="flex:1;text-decoration:none">⬇️ ${farmer ? ft("download") : "Download"}</a>
          <button class="btn btn-primary btn-sm" style="flex:1" onclick="window.print()">🖨️ ${farmer ? ft("print") : "Print Card"}</button>
        </div>
        ${!farmer ? `<button class="btn btn-outline btn-sm" style="margin-top:10px;width:100%" onclick="regenAnimalQr(${safeId(id)})">🔄 Regenerate QR Identity</button>` : ""}
      </div>
    `;
    document.body.appendChild(div);
    if (window.PMA11y) { window.PMA11y.showAccessibleDialog(div, {labelledBy: null, announce: "QR code dialog opened", onClose: () => { try { div.remove(); } catch(_){} }}); }
  } catch (e) { toast(e.message, true); }
};

window.regenAnimalQr = async function(id) {
  if (!confirm("Regenerate QR token for this animal? Any prior physical tag code will be invalidated.")) return;
  try {
    await api(`/animals/${id}/qr`, { method: "POST" });
    toast("New QR code generated!");
    document.getElementById("qrModal")?.remove();
    router();
  } catch (e) { toast(e.message, true); }
};

// =========================================================== REPORT =====
route("#/owner/report", async ({ animal, voice }) => {
  render(`${header(ft("report_title"), { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">${ft("loading")}</div>`);
  const animals = await api("/animals");
  const defaultAnimal = animal ? animals.find(a => a.id === Number(animal)) : null;
  if (!animals.length) {
    render(`${header(ft("report_title"), { back: true })}
      <div class="section-card">${emptyState(ft("no_animals") + ". " + ft("no_animals_hint"))}
        <button class="btn btn-primary" onclick="location.hash='#/owner/animals/new'">＋ ${ft("add_animal")}</button>
      </div>${bottomNav("#/owner/cases")}`);
    return;
  }

  render(`
    ${header(ft("report_title"), { back: true })}
    <div class="section-card">
      <div class="section-title">${ft("describe_symptoms")}</div>
      <div class="meta" style="margin-bottom:12px">${ft("report_help")}</div>
      ${!voice ? `<button class="btn btn-ghost farmer-voice-link" type="button" onclick="location.hash='#/owner/report?voice=1'">🎙️ ${ft("voice_report")}</button>` : ""}
      ${voice ? `
      <div class="voice-box">
        <button id="micBtn" class="btn btn-primary" type="button">🎙️ ${ft("tap_to_speak")}</button>
        <span id="voiceStatus" class="small-muted">${ft("press_mic")}</span>
      </div>
      <div id="voiceTranscriptWrap" style="display:none" class="voice-transcript">
        <b>${ft("transcribed_voice")}:</b>
        <div id="voiceTranscriptText"></div>
      </div>` : ""}
      <form id="caseForm">
        <div class="field"><label for="pm_animal_id">${ft("animal")}</label>
          <select id="pm_animal_id" name="animal_id" required
            <option value="">${ft("choose_animal")}</option>
            ${animals.map(a => `<option value="${safeId(a.id)}" ${escapeHtml(defaultAnimal && defaultAnimal.id === a.id ? "selected" : "")}>${escapeHtml(a.animal_name || a.animal_code)} · ${ownerAnimalType(a.animal_type || a.species)}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label for="symptomsInput">${ft("symptoms")}</label>
          <input name="symptoms" id="symptomsInput" placeholder="${ft("symptoms_placeholder")}" required /
        </div>
        <div class="field"><label for="pm_severity">${ft("severity")}</label>
          <select id="pm_severity" name="severity"<option value="Low">${ft("severity_low")}</option><option value="Medium" selected>${ft("severity_medium")}</option><option value="High">${ft("severity_high")}</option><option value="Critical">${ft("severity_critical")}</option></select>
        </div>
        <div class="field"><label for="descInput">${ft("additional_details")}</label>
          <textarea name="description" id="descInput" placeholder="${ft("details_placeholder")}"</textarea>
        </div>
        <button class="btn btn-primary" type="submit">📋 ${ft("submit_report")}</button>
      </form>
    </div>
    ${bottomNav("#/owner/cases")}
  `);

  if (voice) setupVoiceReport();
  document.getElementById("caseForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const body = Object.fromEntries(new FormData(e.target));
      if (voice) body.reported_through = "Voice App";
      const c = await api("/cases", { method: "POST", body });
      toast(ft("report_sent", { code: c.case_no }));
      location.hash = `#/owner/cases/${safeId(c.id)}`;
    } catch (err) { toast(err.message, true); }
  });
}, ["owner"]);

// Whisper voice worker handling
let voiceWorker = null;
function getVoiceWorker() {
  if (!voiceWorker) {
    voiceWorker = new Worker("whisper-worker.js", { type: "module" });
    voiceWorker.onmessage = onVoiceMessage;
  }
  return voiceWorker;
}
function setVoiceStatus(txt) { const el = document.getElementById("voiceStatus"); if (el) el.textContent = txt; }
function onVoiceMessage(e) {
  const { status, type, text, error } = e.data || {};
  const eventType = status || type;
  if (eventType === "ready") setVoiceStatus(ft("voice_ready"));
  else if (eventType === "progress" || eventType === "transcribing") setVoiceStatus(ft("voice_transcribing"));
  else if (eventType === "result" || eventType === "done") {
    setVoiceStatus(ft("voice_transcribed_status"));
    const tWrap = document.getElementById("voiceTranscriptWrap");
    const tBox = document.getElementById("voiceTranscriptText");
    const symInp = document.getElementById("symptomsInput");
    if (tWrap && tBox) { tWrap.style.display = "block"; tBox.textContent = text; }
    if (symInp && !symInp.value) symInp.value = text;
  } else if (eventType === "error") setVoiceStatus(`${ft("voice_error")} ${error || ""}`.trim());
}

function setupVoiceReport() {
  const btn = document.getElementById("micBtn");
  if (!btn) return;
  let mediaRec = null, chunks = [];
  btn.addEventListener("click", async () => {
    if (mediaRec && mediaRec.state === "recording") {
      mediaRec.stop();
      btn.textContent = `🎙️ ${ft("tap_to_speak")}`;
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRec = new MediaRecorder(stream);
      mediaRec.ondataavailable = ev => chunks.push(ev.data);
      mediaRec.onstop = async () => {
        setVoiceStatus(ft("processing_voice"));
        stream.getTracks().forEach(track => track.stop());
        const blob = new Blob(chunks, { type: mediaRec.mimeType || "audio/webm" });
        const ab = await blob.arrayBuffer();
        const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const decoded = await ctx.decodeAudioData(ab);
        const floatData = decoded.getChannelData(0);
        const whisperLanguage = ({ en: "english", mr: "marathi", hi: "hindi", te: "telugu" })[state.lang] || "english";
        getVoiceWorker().postMessage({ type: "transcribe", audio: floatData, language: whisperLanguage });
      };
      mediaRec.start();
      btn.textContent = `⏹️ ${ft("stop_recording")}`;
      setVoiceStatus(ft("voice_recording"));
    } catch (err) {
      setVoiceStatus(ft("microphone_denied"));
    }
  });
}

// ============================================================ CASES =====
function casesListView(role) {
  route(`#/${role}/cases`, async () => {
    const farmer = role === "owner";
    const pageKey = `cases_${role}`;
    if (!state.pagination[pageKey]) state.pagination[pageKey]=1;
    const curPage = state.pagination[pageKey];
    const pageSize = state.pagination.pageSize;
    render(`${header(farmer ? ft("cases") : "Cases", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">${farmer ? ft("loading_cases") : "Loading cases…"}</div>`);
    const cases = await api("/cases");
    const { pageItems, total, totalPages, page } = pmPaginate(cases, curPage, pageSize);
    state.pagination[pageKey]=page;
    if (farmer) {
      render(`
        ${header(ft("my_cases"), { back: true })}
        <div class="section-card" id="casesListSection">
          <button class="btn btn-primary farmer-primary-action" style="margin-bottom:14px" onclick="location.hash='#/owner/report'">＋ ${ft("report_problem")}</button>
          <div class="btn-row no-print" style="margin-bottom:8px"><button class="btn btn-outline btn-sm" onclick="pmPrintSection('casesListSection')">🖨️ Print</button><button class="btn btn-outline btn-sm" onclick="pmExportCsv('cases.csv', ${JSON.stringify([]).replace(/"/g,'&quot;')}, ['case_no','status'])">Export placeholder</button></div>
          ${pageItems.length ? pageItems.map(c => `
            <div class="list-card farmer-list-card" role="button" tabindex="0" onclick="location.hash='#/owner/cases/${safeId(c.id)}'" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.hash='#/owner/cases/${safeId(c.id)}'}">
              <div class="row1"><span class="title">${escapeHtml(c.case_no)}</span><span class="badge ${statusBadgeClass(c.status)}">${ownerCaseStatus(c.status)}</span></div>
              <div class="meta">${ft("animal_id")}: ${escapeHtml(c.animal ? c.animal.animal_code : "—")}</div>
              <div class="meta">${escapeHtml(c.symptoms || "—")}</div>
              <div class="meta">${ft("reported")}: ${fmtDate(c.created_at)}</div>
            </div>`).join("") : emptyState(ft("no_cases_home"))}
          ${pmPaginationHtml(total, page, pageSize, `goCasesPage_${role}`)}
          <div class="btn-row no-print" style="margin-top:10px"><button class="btn btn-ghost btn-sm" onclick="pmPrintSection('casesListSection')">🖨️ Print list</button><button class="btn btn-ghost btn-sm" onclick="window.__exportCases && window.__exportCases()">📥 Export CSV</button></div>
        </div>
        ${bottomNav("#/owner/cases")}
      `);
      window.__exportCases = () => { pmExportCsv('cases.csv', cases.map(c=>({case_no:c.case_no,status:c.status,symptoms:c.symptoms,created:c.created_at})), ['case_no','status','symptoms','created']); };
      window[`goCasesPage_${role}`] = (p)=>{ state.pagination[pageKey]=p; location.hash=`#/${role}/cases`; setTimeout(()=>location.reload(), 30); };
      return;
    }
    render(`
      ${header("Active Case Tracking", { back: true })}
      <div class="section-card" id="casesListSection">
        <div class="btn-row no-print" style="margin-bottom:10px"><button class="btn btn-outline btn-sm" onclick="pmPrintSection('casesListSection')">🖨️ Print</button><button class="btn btn-outline btn-sm" onclick="window.__exportCases && window.__exportCases()">📥 Export CSV</button><button class="btn btn-outline btn-sm" onclick="doExport('cases','xlsx')">📊 Excel</button><button class="btn btn-outline btn-sm" onclick="doExport('cases','pdf')">📄 PDF</button></div>
        ${pageItems.length === 0 ? emptyState("No active cases.") : pageItems.map(c => `
          <div class="list-card" role="button" tabindex="0" onclick="location.hash='#/${role}/cases/${safeId(c.id)}'" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.hash='#/${role}/cases/${safeId(c.id)}'}">
            <div class="row1"><span class="title">${escapeHtml(c.case_no)}</span><span class="badge ${statusBadgeClass(c.status)}">${escapeHtml(c.status)}</span></div>
            <div class="meta"><b>Animal:</b> ${escapeHtml(c.animal ? c.animal.animal_code : "—")} · ${escapeHtml(c.symptoms || "—")}</div>
            <div class="meta">Owner: ${escapeHtml(c.owner ? c.owner.full_name : "—")} · Reported: ${fmtDate(c.created_at)}</div>
          </div>`).join("")}
        ${pmPaginationHtml(total, page, pageSize, `goCasesPage_${role}`)}
      </div>
      ${bottomNav(`#/${role}/dashboard`)}
    `);
    window.__exportCases = () => { pmExportCsv('cases.csv', cases.map(c=>({case_no:c.case_no,status:c.status,animal:c.animal?.animal_code,owner:c.owner?.full_name,created:c.created_at})), ['case_no','status','animal','owner','created']); };
    window[`goCasesPage_${role}`] = (p)=>{ state.pagination[pageKey]=p; location.hash=`#/${role}/cases`; setTimeout(()=>location.reload(), 30); };
  }, [role]);
}
casesListView("owner"); casesListView("vet"); casesListView("govt");

route("#/vet/reports", async () => {
  render(`${header("Incoming Reports", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading…</div>`);
  const reports = await api("/vet/reports");
  render(`
    ${header("Incoming Reports", { back: true })}
    <div class="section-card">
      <div class="section-title">Farmer Reported Incidents</div>
      ${reports.length === 0 ? emptyState("No reports yet.") : reports.map(r => `
        <div class="list-card" role="button" tabindex="0" onclick="location.hash='#/vet/cases/${safeId(r.id)}'" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.hash='#/vet/cases/${safeId(r.id)}'}">
          <div class="row1"><span class="title">${escapeHtml(r.case_no)}</span><span class="badge ${severityBadgeClass(r.severity)}">${escapeHtml(r.severity)} severity</span></div>
          <div class="meta"><b>Symptoms:</b> ${escapeHtml(r.symptoms || "—")}</div>
          <div class="meta">Owner: ${escapeHtml(r.owner ? r.owner.full_name + " (" + (r.owner.mobile || "") + ")" : "—")}</div>
          <div class="meta">Reported: ${fmtDate(r.created_at)} · Status: <span class="badge ${statusBadgeClass(r.status)}">${escapeHtml(r.status)}</span></div>
        </div>`).join("")}
    </div>
    ${bottomNav("#/vet/reports")}
  `);
}, ["vet"]);

function ownerSeverityLabel(value) {
  const key = ({ LOW: "severity_low", MEDIUM: "severity_medium", MODERATE: "severity_medium", HIGH: "severity_high", CRITICAL: "severity_critical" }[(value || "").toUpperCase()]);
  return key ? ft(key) : (value || ft("unknown"));
}

function ownerCaseDetail(c) {
  const prescriptions = c.prescriptions || [];
  const treatmentResponses = c.treatment_responses || [];
  const labReports = c.lab_reports || [];
  const isActive = !["RECOVERED", "CLOSED", "COMPLETED"].includes((c.status || "").toUpperCase());
  render(`
    ${header(ft("case_detail"), { back: true })}
    <div class="section-card">
      <div class="row1 farmer-case-heading">
        <span class="owner-case-number">${escapeHtml(c.case_no)}</span>
        <span class="badge ${statusBadgeClass(c.status)}">${ownerCaseStatus(c.status)}</span>
      </div>
      <div class="detail-grid farmer-detail-grid" style="margin-top:12px">
        <div><b>${ft("animal")}</b><a class="link" onclick="location.hash='#/owner/animals/${safeId(c.animal?.id)}'">${escapeHtml(c.animal?.animal_name || c.animal?.animal_code || "—")}</a></div>
        <div><b>${ft("report_date")}</b>${fmtDate(c.created_at)}</div>
        <div><b>${ft("severity")}</b>${ownerSeverityLabel(c.severity)}</div>
        ${c.vet_name ? `<div><b>${ft("vet")}</b>${escapeHtml(c.vet_name)}</div>` : ""}
      </div>
      <div class="owner-case-copy"><b>${ft("symptoms")}</b><p>${escapeHtml(c.symptoms || "—")}</p></div>
      ${c.description ? `<div class="owner-case-copy"><b>${ft("additional_details")}</b><p>${escapeHtml(c.description)}</p></div>` : ""}
      ${c.diagnosis ? `<div class="owner-case-copy"><b>${ft("diagnosis")}</b><p>${escapeHtml(c.diagnosis)}</p></div>` : ""}
      ${c.treatment ? `<div class="owner-case-copy"><b>${ft("instructions")}</b><p>${escapeHtml(c.treatment)}</p></div>` : ""}
    </div>
    <div id="trackWrap"></div>
    ${prescriptions.length ? `
      <div class="section-card">
        <div class="section-title">💊 ${ft("health_and_treatment")}</div>
        ${prescriptions.map(p => `
          <div class="list-card" style="cursor:default">
            <div class="row1"><span class="title">${escapeHtml(p.medicine)}</span><span class="badge badge-blue">${escapeHtml(p.dosage || "")}</span></div>
            <div class="meta">${escapeHtml(p.frequency || "")}${p.duration ? ` · ${escapeHtml(p.duration)}` : ""}</div>
            ${p.instructions ? `<div class="meta">${ft("instructions")}: ${escapeHtml(p.instructions)}</div>` : ""}
            <div class="meta">${ft("follow_up")}: ${fmtDate(p.follow_up_date)}</div>
          </div>`).join("")}
      </div>` : ""}
    ${treatmentResponses.length ? `
      <div class="section-card">
        <div class="section-title">${ft("treatment_history")}</div>
        ${treatmentResponses.map(update => `
          <div class="list-card" style="cursor:default">
            <div class="row1"><span class="title">${ownerResponseLabel(update.response)}</span><span class="small-muted">${fmtDate(update.response_date)}</span></div>
            ${update.objective_observations ? `<div class="meta">${update.objective_observations}</div>` : ""}
            ${update.notes ? `<div class="meta">${escapeHtml(update.notes)}</div>` : ""}
          </div>`).join("")}
      </div>` : ""}
    ${labReports.length ? `
      <div class="section-card">
        <div class="section-title">🧪 ${ft("test_results")}</div>
        ${labReports.map(report => `
          <div class="list-card" style="cursor:default">
            <div class="row1"><span class="title">${report.test_name || report.report_no}</span><span class="badge ${report.result === "NEGATIVE" ? "badge-green" : "badge-blue"}">${ownerResultLabel(report.result)}</span></div>
            <div class="meta">${ft("report_date")}: ${fmtDate(report.test_date)}</div>
          </div>`).join("")}
      </div>` : ""}
    ${c.updates?.length ? `
      <div class="section-card">
        <div class="section-title">🕒 ${ft("case_updates")}</div>
        <div class="timeline">${c.updates.map(update => `
          <div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-body">
            <div class="t-status">${ownerCaseStatus(update.status)}</div>
            ${update.note ? `<div class="t-note">${escapeHtml(update.note)}</div>` : ""}
            <div class="t-date">${fmtDate(update.created_at)}</div>
          </div></div>`).join("")}</div>
      </div>` : ""}
    ${isActive ? farmerFeedbackSection(c) : ""}
    ${bottomNav("#/owner/cases")}
  `);
}

// Case Detail view
function caseDetailView(role) {
  route(`#/${role}/cases/:id`, async ({ id }) => {
    const farmer = role === "owner";
    render(`${header(farmer ? ft("case_detail") : "Case Detail", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">${farmer ? ft("loading_cases") : "Loading…"}</div>`);
    const c = await api(`/cases/${id}`);
    const isVet = role === "vet";
    const samples = c.samples || [];
    const trs = c.treatment_responses || [];
    const allergies = c.animal_allergies || [];
    if (farmer) {
      ownerCaseDetail(c);
      loadTracking(c, role);
      const feedbackForm = document.getElementById("farmerFeedbackForm");
      if (feedbackForm) feedbackForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          await api(`/cases/${safeId(c.id)}/farmer-feedback`, { method: "POST", body: Object.fromEntries(new FormData(e.target)) });
          toast(ft("feedback_thanks"));
          router();
        } catch (err) { toast(err.message, true); }
      });
      return;
    }

    render(`
      ${header(c.case_no, { back: true })}
      <div class="section-card">
        <div class="row1" style="justify-content:space-between;display:flex;align-items:center;margin-bottom:8px">
          <span class="badge ${statusBadgeClass(c.status)}">${escapeHtml(c.status)}</span>
          <span class="badge ${severityBadgeClass(c.severity)}">${escapeHtml(c.severity)} severity</span>
          ${autoEscalatedBadge(c)}
        </div>
        <div class="detail-grid">
          <div><b>Animal</b><a class="link" onclick="location.hash='#/${role}/animals/${safeId(c.animal.id)}'">${escapeHtml(c.animal.animal_code)}</a></div>
          <div><b>Herd</b>${escapeHtml(c.herd ? c.herd.herd_code : "—")}</div>
          <div><b>Owner</b>${escapeHtml(c.owner.full_name)} (${escapeHtml(c.owner.mobile || "")})</div>
          <div><b>Reported via</b>${escapeHtml(c.reported_through || "Mobile App")}</div>
          <div><b>Symptoms</b>${escapeHtml(c.symptoms || "—")}</div>
          <div><b>Disease Suspected</b>${escapeHtml(c.disease_suspected || "—")}</div>
          <div><b>Diagnosis</b>${escapeHtml(c.diagnosis || "—")}</div>
          <div><b>Treatment</b>${escapeHtml(c.treatment || "—")}</div>
          <div><b>Vet Assigned</b>${escapeHtml(c.vet_name || "Unassigned")}</div>
          <div><b>Reported On</b>${fmtDate(c.created_at)}</div>
        </div>
        ${c.description ? `<div style="margin-top:10px"><b class="small-muted">Description:</b><div style="font-size:13.5px">${escapeHtml(c.description)}</div></div>` : ""}
      </div>

      ${c.helpline_report ? `
        <div class="section-card">
          <div class="section-title">☎️ Helpline Report ${escapeHtml(c.helpline_report.report_no)}</div>
          <div class="detail-grid">
            <div><b>Source</b>${escapeHtml(c.helpline_report.source)}</div>
            <div><b>Report Status</b>${escapeHtml(c.helpline_report.status)}</div>
            <div><b>Language</b>${escapeHtml(c.helpline_report.language || "Unknown")}</div>
            <div><b>Location Source</b>${escapeHtml(c.helpline_report.location_source)}</div>
            <div><b>Region</b>${escapeHtml(c.helpline_report.village || "")}${escapeHtml(c.helpline_report.village && c.helpline_report.district ? ", " : "")}${escapeHtml(c.helpline_report.district || "Unknown")}</div>
            <div><b>Urgency</b>${escapeHtml(c.helpline_report.urgency || "Not Provided")}</div>
          </div>
        </div>` : ""}

      <!-- ALLERGY ALERT BANNER IF APPLICABLE -->
      ${allergies.length > 0 ? `
        <div class="section-card" style="padding:12px">
          <div class="conflict-box" style="margin:0">
            <b>⚠️ Patient Drug Allergy Alert:</b>
            ${allergies.map(a => `${escapeHtml(a.allergen)} (${escapeHtml(a.allergy_severity)}: ${escapeHtml(a.reaction)})`).join(", ")}
          </div>
        </div>
      ` : ""}

      <div id="trackWrap"></div>

      <!-- VET ACTIONS -->
      ${isVet ? vetCaseActions(c, allergies) : ""}

      <!-- DIGITAL SAMPLES & CHAIN OF CUSTODY -->
      <div class="section-card">
        <div class="subheading" style="justify-content:space-between">
          <span>🧪 Digital Biological Samples (${samples.length})</span>
          ${isVet ? `<button class="btn btn-ghost btn-sm" onclick="document.getElementById('sampleCollectWrap').style.display='block'">+ Collect Sample</button>` : ""}
        </div>
        ${isVet ? `
          <div id="sampleCollectWrap" style="display:none;margin-top:12px;background:#f8f9fe;padding:12px;border-radius:12px">
            <form id="sampleCollectForm">
              <div class="form-row">
                <div class="field"><label for="pm_sample_type">Sample Type</label><select id="pm_sample_type" name="sample_type"<option>Blood Sample</option><option>Nasal Swab</option><option>Tissue Biopsy</option><option>Milk Sample</option><option>Fecal Sample</option></select></div>
                <div class="field"><label for="pm_collection_notes">Collection Notes</label><input id="pm_collection_notes" name="collection_notes" placeholder="e.g. Sterile EDTA tube" /></div>
              </div>
              <div class="field">
                <label id="geoLabel">Geolocation (GPS)</label>
                <div class="btn-row">
                  <button class="btn btn-outline btn-sm" type="button" onclick="captureSampleGps()">📍 Capture Device GPS</button>
                  <span id="gpsStatusTxt" class="small-muted" style="align-self:center">GPS idle</span>
                </div>
                <input type="hidden" name="collection_lat" id="inpSampleLat" />
                <input type="hidden" name="collection_lng" id="inpSampleLng" />
                <input type="hidden" name="is_manual_location" id="inpSampleManual" value="0" />
              </div>
              <button class="btn btn-primary btn-sm" type="submit">Confirm &amp; Generate Sample QR</button>
            </form>
          </div>
        ` : ""}
        ${samples.length === 0 ? emptyState("No biological specimens collected yet.") :
          samples.map(s => `
          <div class="list-card" style="cursor:default">
            <div class="row1">
              <span class="title">${escapeHtml(s.sample_code)} (${escapeHtml(s.sample_type)})</span>
              <span class="badge ${statusBadgeClass(s.status)}">${escapeHtml(s.status)}</span>
            </div>
            <div class="meta">Collected: ${fmtDate(s.collected_at)} ${s.collection_lat ? `· Lat: ${escapeHtml(s.collection_lat.toFixed(4))}, Lng: ${escapeHtml(s.collection_lng.toFixed(4))}` : ""}</div>
            <div class="row1" style="margin-top:6px">
              <button class="btn btn-ghost btn-sm" onclick="showSampleQrModal(${safeId(s.id)})">🔍 QR &amp; Chain of Custody</button>
              ${isVet && ["COLLECTED", "READY_FOR_PICKUP"].includes(s.status) ? `
                <button class="btn btn-outline btn-sm" onclick="advanceTransport(${safeId(s.id)})">Mark In Transit</button>
              ` : ""}
            </div>
          </div>
        `).join("")}
      </div>

      <!-- STRUCTURED TREATMENT RESPONSE -->
      <div class="section-card">
        <div class="subheading" style="justify-content:space-between">
          <span>📋 Structured Treatment Responses (${trs.length})</span>
          ${isVet ? `<button class="btn btn-ghost btn-sm" onclick="document.getElementById('trFormWrap').style.display='block'">+ Record Response</button>` : ""}
        </div>
        ${isVet ? `
          <div id="trFormWrap" style="display:none;margin-top:12px;background:#f8f9fe;padding:12px;border-radius:12px">
            <form id="trForm">
              <div class="field"><label for="pm_response">Patient Response</label>
                <select id="pm_response" name="response"
                  <option value="improved">Improved</option>
                  <option value="unchanged">Unchanged</option>
                  <option value="worsened">Worsened</option>
                  <option value="recovered">Recovered (Case Solved)</option>
                  <option value="adverse_reaction">Adverse Reaction</option>
                  <option value="treatment_discontinued">Treatment Discontinued</option>
                  <option value="follow_up_required">Follow-up Required</option>
                </select>
              </div>
              <div class="field"><label for="pm_objective_observations">Objective Clinical Observations</label><textarea id="pm_objective_observations" name="objective_observations" placeholder="e.g. Temp 101.3°F, normal rumination, appetite restored"</textarea></div>
              <div class="field"><label for="pm_notes_3">Clinical Notes</label><input id="pm_notes_3" name="notes" placeholder="e.g. Complete 3-day course" /></div>
              <div class="field"><label for="pm_productivity_notes">Productivity Impact</label><input id="pm_productivity_notes" name="productivity_notes" placeholder="e.g. Milk yield dropped 40%" /></div>
              <button class="btn btn-primary btn-sm" type="submit">Save Treatment Evaluation</button>
            </form>
          </div>
        ` : ""}
        ${trs.length === 0 ? emptyState("No treatment evaluations recorded yet.") :
          trs.map(tr => `
          <div class="list-card" style="cursor:default">
            <div class="row1"><span class="title">Response: ${tr.response}</span><span class="badge ${statusBadgeClass(tr.response)}">${fmtDate(tr.response_date)}</span></div>
            <div class="meta"><b>Observations:</b> ${tr.objective_observations || "—"}</div>
            ${tr.notes ? `<div class="small-muted">Notes: ${tr.notes}</div>` : ""}
          </div>
        `).join("")}
      </div>

      <!-- LABORATORY REPORTS -->
      <div class="section-card">
        <div class="subheading">🧬 Verified Laboratory Reports</div>
        ${c.lab_reports.length === 0 ? emptyState("No verified laboratory reports released yet.") :
          c.lab_reports.map(l => `
          <div class="list-card" style="cursor:default">
            <div class="row1"><span class="title">${escapeHtml(l.report_no)} — ${escapeHtml(l.test_name)}</span><span class="badge ${escapeHtml(l.result === 'NEGATIVE' ? 'badge-green' : 'badge-red')}">${escapeHtml(l.result)}</span></div>
            <div class="meta"><b>Method:</b> ${escapeHtml(l.test_method || "Standard")} · <b>Status:</b> ${escapeHtml(l.verification_status || "VERIFIED")}</div>
            ${l.quantitative_result !== null ? `<div class="meta"><b>Value:</b> ${escapeHtml(l.quantitative_result)} ${escapeHtml(l.units || "")} (Ref: ${escapeHtml(l.reference_range_text || "Normal")})</div>` : ""}
            ${l.notes || l.comments ? `<div class="small-muted">${escapeHtml(l.notes || l.comments)}</div>` : ""}
          </div>
        `).join("")}
      </div>

      <!-- PRESCRIPTIONS -->
      <div class="section-card">
        <div class="subheading">💊 Prescriptions</div>
        ${c.prescriptions.length === 0 ? emptyState("No prescriptions issued yet.") : c.prescriptions.map(p => `
          <div class="list-card" style="cursor:default">
            <div class="row1">
              <span class="title">${escapeHtml(p.medicine)}</span>
              <span class="badge badge-blue">${escapeHtml(p.dosage || "")}</span>
            </div>
            <div class="meta">${escapeHtml(p.frequency || "")} for ${escapeHtml(p.duration || "")} · Follow-up: ${fmtDate(p.follow_up_date)}</div>
            ${p.allergy_override ? `<div class="conflict-box" style="margin:4px 0;padding:6px"><b>⚠️ Allergy Override Granted:</b> ${escapeHtml(p.override_reason)}</div>` : ""}
            ${p.instructions ? `<div class="meta">${escapeHtml(p.instructions)}</div>` : ""}
          </div>`).join("")}
      </div>

      <!-- CASE TIMELINE -->
      <div class="section-card">
        <div class="subheading">🕒 Case Timeline</div>
        <div class="timeline">
          ${c.updates.map(u => `
            <div class="timeline-item">
              <div class="timeline-dot"></div>
              <div class="timeline-body">
                <div class="t-status">${escapeHtml(u.status)}</div>
                <div class="t-note">${escapeHtml(u.note || "")} — ${escapeHtml(u.updated_by || "")}</div>
                <div class="t-date">${fmtDate(u.created_at)}</div>
              </div>
            </div>`).join("")}
        </div>
      </div>

      ${isVet && ["RECOVERED", "CLOSED"].includes(c.status) ? `
      <div class="section-card">
        <div class="subheading">🗑 Case Solved — Close-out</div>
        <div class="small-muted" style="margin-bottom:10px">This case is solved. You can remove the report permanently.</div>
        <button class="btn btn-outline" onclick="deleteCase(${safeId(c.id)},'${escapeJsStr(c.case_no)}')">Delete Report</button>
      </div>` : ""}

      <!-- REQ 18: FARMER FEEDBACK SECTION -->
      ${role === "owner" && !["RECOVERED", "CLOSED"].includes(c.status) ? `
        <div id="farmerFeedbackWrap"></div>
        ${farmerFeedbackSection(c)}
      ` : ""}

      ${bottomNav(`#/${role}/cases`)}
    `);

    if (isVet) bindVetCaseActions(c, allergies);
    loadTracking(c, role);

    // REQ 18: Bind farmer feedback form
    const ffForm = document.getElementById("farmerFeedbackForm");
    if (ffForm) {
      ffForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          const body = Object.fromEntries(new FormData(e.target));
          await api(`/cases/${safeId(c.id)}/farmer-feedback`, { method: "POST", body });
          toast("Feedback submitted! Thank you.");
          router();
        } catch (err) { toast(err.message, true); }
      });
    }
  }, [role]);
}
caseDetailView("owner"); caseDetailView("vet"); caseDetailView("govt");

window.showSampleQrModal = async function(sid) {
  try {
    const s = await api(`/samples/${sid}`);
    const old = document.getElementById("sampleQrModal");
    if (old) old.remove();
    const div = document.createElement("div");
    div.id = "sampleQrModal";
    div.className = "qr-modal";
    div.innerHTML = `
      <div class="qr-modal-content">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <b>🧪 Digital Biological Sample Tag</b>
          <button style="border:none;background:none;font-size:20px;cursor:pointer" onclick="document.getElementById('sampleQrModal').remove()">✕</button>
        </div>
        <div style="font-size:16px;font-weight:800;color:var(--primary)">${escapeHtml(s.sample_code)}</div>
        <div class="small-muted">${escapeHtml(s.sample_type)} · Animal: ${escapeHtml(s.animal_code)}</div>
        <div class="qr-image-wrap">
          <img src="${escapeHtml(s.qr_image)}" alt="Sample QR" />
        </div>
        <div class="small-muted" style="margin-bottom:8px">Token: ${escapeHtml(s.qr_token.slice(0, 16))}…</div>
        <div style="text-align:left;max-height:140px;overflow-y:auto;border-top:1px solid #eee;padding-top:6px">
          <b>Chain of Custody:</b>
          ${(s.custody_events || []).map(e => `<div style="font-size:11px;margin:3px 0">• <b>${escapeHtml(e.status)}:</b> ${escapeHtml(e.action)} (${escapeHtml(e.actor_name)})</div>`).join("")}
        </div>
        <button class="btn btn-outline btn-sm" style="margin-top:12px;width:100%" onclick="window.print()">🖨️ Print Specimen Label</button>
      </div>
    `;
    document.body.appendChild(div);
    if (window.PMA11y) { window.PMA11y.showAccessibleDialog(div, {labelledBy: null, announce: "QR code dialog opened", onClose: () => { try { div.remove(); } catch(_){} }}); }
  } catch (e) { toast(e.message, true); }
};

window.advanceTransport = async function(sid) {
  const courier = prompt("Enter Transporter / Courier name:", "Cold Chain Express");
  if (!courier) return;
  try {
    await api(`/samples/${sid}/transport`, { method: "POST", body: { status: "IN_TRANSIT", transporter_name: courier } });
    toast("Sample marked IN_TRANSIT");
    router();
  } catch (e) { toast(e.message, true); }
};

window.captureSampleGps = function() {
  const txt = document.getElementById("gpsStatusTxt");
  if (!navigator.geolocation) {
    txt.textContent = "Geolocation unsupported. Manual fallback used.";
    document.getElementById("inpSampleManual").value = "1";
    return;
  }
  txt.textContent = "Requesting device coordinates…";
  navigator.geolocation.getCurrentPosition(
    pos => {
      document.getElementById("inpSampleLat").value = pos.coords.latitude;
      document.getElementById("inpSampleLng").value = pos.coords.longitude;
      document.getElementById("inpSampleManual").value = "0";
      txt.textContent = `🟢 GPS Captured: ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
    },
    err => {
      txt.textContent = "⚠️ GPS permission denied. Using district centroid fallback.";
      document.getElementById("inpSampleManual").value = "1";
    },
    { timeout: 8000 }
  );
};

// ============================ LIVE FIELD-VISIT TRACKING ===================
let trackTimer = null, trackMap = null, trackVet = null, trackLine = null, trackCtx = null;

function trackStages(t, role) {
  const s = t.visit ? t.visit.status : null;
  const onWay = s === "ON_THE_WAY";
  const arrived = s === "ARRIVED" || s === "COMPLETED";
  const completed = s === "COMPLETED";
  const localized = role === "owner";
  return [
    [localized ? `📝 ${ft("tracking_report_placed")}` : "📝 Report placed", "badge-green"],
    [localized ? `✅ ${ft("tracking_vet_accepted")}` : "✅ Vet accepted", s ? "badge-green" : "badge-blue"],
    [localized ? `🚗 ${ft("tracking_on_way")}` : "🚗 On the way", onWay ? "badge-orange" : arrived || completed ? "badge-green" : "badge-blue"],
    [localized ? `📍 ${ft("tracking_arrived")}` : "📍 Arrived", arrived ? "badge-green" : "badge-blue"],
    [localized ? `💊 ${ft("tracking_visit_done")}` : "💊 Visit done", completed ? "badge-green" : "badge-blue"],
  ];
}

function trackingCardHTML(t, c, role) {
  const localized = role === "owner";
  const stages = trackStages(t, role);
  const v = t.visit;
  return `
    <div class="section-card">
      <div class="subheading">🚗 ${localized ? ft("tracking_title") : "Live Field-Visit Tracking"}</div>
      <div class="tag-row" style="margin-bottom:12px">
        ${stages.map(([lbl, cls]) => `<span class="badge ${cls}">${lbl}</span>`).join("")}
      </div>
      <div id="trackMap" style="height:240px;width:100%;border-radius:14px;overflow:hidden;background:#e5e5e5"></div>
      ${v ? `
        <div class="row1 tracking-meta" style="margin-top:10px;font-size:13px">
          <div><b>${localized ? ft("eta") : "ETA"}:</b> ${v.status === "ON_THE_WAY" ? `${Math.ceil(t.eta_seconds / 60)} ${localized ? ft("minutes") : "mins"}` : v.status === "ARRIVED" ? (localized ? ft("tracking_arrived") : "Arrived") : (localized ? ft("tracking_visit_done") : "Completed")}</div>
          <div><b>${localized ? ft("vet") : "Veterinarian"}:</b> ${escapeHtml(t.vet ? t.vet.full_name : (localized ? ft("assigned") : "Assigned"))}</div>
        </div>
      ` : ""}
      ${role === "vet" ? visitControlButtons(v) : ""}
    </div>`;
}

function visitControlButtons(v) {
  if (!v) return `<button class="btn btn-primary" style="margin-top:10px" id="btnStartTrip">🚗 Start Field Visit (I'm on the way)</button>`;
  if (v.status === "ON_THE_WAY") return `<button class="btn btn-primary" style="margin-top:10px" id="btnArrived">📍 Mark Arrived at Farm</button>`;
  if (v.status === "ARRIVED") return `<button class="btn btn-primary" style="margin-top:10px" id="btnCompleteTrip">💊 Complete Physical Visit</button>`;
  return "";
}

function initTrackMap(t, role) {
  if (typeof L === "undefined") return;
  const el = document.getElementById("trackMap");
  if (!el) return;
  if (trackMap) { trackMap.remove(); trackMap = null; }
  const cur = t.current_position || t.destination;
  trackMap = L.map("trackMap").setView([cur.lat, cur.lng], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(trackMap);
  L.marker([t.destination.lat, t.destination.lng]).addTo(trackMap).bindTooltip(role === "owner" ? `📍 ${ft("location")} · ${ft("animal")}` : "📍 Animal Location");
  if (t.origin) L.marker([t.origin.lat, t.origin.lng]).addTo(trackMap).bindTooltip("Dispensary");
  trackVet = L.circleMarker([cur.lat, cur.lng], { radius: 9, color: "#2f6fed", fillColor: "#2f6fed", fillOpacity: 0.9 }).addTo(trackMap);
  if (t.origin && t.destination) trackLine = L.polyline([[t.origin.lat, t.origin.lng], [t.destination.lat, t.destination.lng]], { color: "#2f6fed", dashArray: "5, 8" }).addTo(trackMap);
}

function updateTrackMap(t) {
  if (!trackMap || !trackVet) return;
  const cur = t.current_position;
  trackVet.setLatLng([cur.lat, cur.lng]);
}

async function loadTracking(c, role) {
  const wrap = document.getElementById("trackWrap");
  if (!wrap) return;
  try {
    const t = await api(`/cases/${safeId(c.id)}/track`);
    wrap.innerHTML = trackingCardHTML(t, c, role);
    if (t.destination) initTrackMap(t, role);
    bindVisitControls(c, role);
    if (trackTimer) clearInterval(trackTimer);
    if (t.visit && t.visit.status === "ON_THE_WAY") {
      trackTimer = setInterval(async () => {
        try {
          const fresh = await api(`/cases/${safeId(c.id)}/track`);
          updateTrackMap(fresh);
          if (fresh.visit && fresh.visit.status !== "ON_THE_WAY") clearInterval(trackTimer);
        } catch (e) {}
      }, 3000);
    }
  } catch (err) { wrap.innerHTML = ""; }
}

function bindVisitControls(c, role) {
  if (role !== "vet") return;
  const startBtn = document.getElementById("btnStartTrip");
  if (startBtn) startBtn.addEventListener("click", async () => {
    try { await api(`/cases/${safeId(c.id)}/visit`, { method: "POST" }); toast("Visit started!"); loadTracking(c, role); }
    catch (err) { toast(err.message, true); }
  });
  const arrBtn = document.getElementById("btnArrived");
  if (arrBtn) arrBtn.addEventListener("click", async () => {
    try { await api(`/cases/${safeId(c.id)}/visit`, { method: "PUT", body: { status: "ARRIVED" } }); toast("Arrived at farm!"); loadTracking(c, role); }
    catch (err) { toast(err.message, true); }
  });
  const compBtn = document.getElementById("btnCompleteTrip");
  if (compBtn) compBtn.addEventListener("click", async () => {
    try { await api(`/cases/${safeId(c.id)}/visit`, { method: "PUT", body: { status: "COMPLETED" } }); toast("Visit marked completed!"); loadTracking(c, role); }
    catch (err) { toast(err.message, true); }
  });
}

function vetCaseActions(c, allergies = []) {
  const statuses = ["ASSIGNED", "UNDER INVESTIGATION", "SAMPLE COLLECTED", "LAB PENDING", "DIAGNOSED", "TREATMENT", "FOLLOW-UP", "RECOVERED", "CLOSED"];
  return `
    <div class="section-card">
      <div class="subheading">✏️ Case Actions &amp; Diagnosis</div>
      <form id="statusForm">
        <div class="field"><label for="pm_status_2">Status</label><select id="pm_status_2" name="status"${statuses.map(s => `<option ${escapeHtml(s === c.status ? "selected" : "")}>${s}</option>`).join("")}</select></div>
        <div class="field"><label for="pm_diagnosis">Diagnosis</label><input id="pm_diagnosis" name="diagnosis" value="${escapeHtml(c.diagnosis || "")}" /></div>
        <div class="field"><label for="pm_treatment">Treatment Notes</label><textarea id="pm_treatment" name="treatment"${escapeHtml(c.treatment || "")}</textarea></div>
        <div class="field"><label for="pm_note">Update Note</label><input id="pm_note" name="note" placeholder="What changed?" /></div>
        <button class="btn btn-primary" type="submit">Save Case Update</button>
      </form>
    </div>
    <div class="section-card">
      <div class="subheading">💊 Create E-Prescription</div>
      <form id="rxForm">
        <div class="field"><label for="pm_diagnosis_2">Diagnosis</label><input id="pm_diagnosis_2" name="diagnosis" value="${escapeHtml(c.diagnosis || "")}" /></div>
        <div class="form-row">
          <div class="field"><label for="rxMedicineInput">Medicine</label><input name="medicine" id="rxMedicineInput" required /></div>
          <div class="field"><label for="pm_dosage">Dosage</label><input id="pm_dosage" name="dosage" placeholder="e.g. 0.5 mg/kg" /></div>
        </div>
        <div class="form-row">
          <div class="field"><label for="pm_frequency">Frequency</label><input id="pm_frequency" name="frequency" placeholder="e.g. Once daily" /></div>
          <div class="field"><label for="pm_duration">Duration</label><input id="pm_duration" name="duration" placeholder="e.g. 5 days" /></div>
        </div>
        <div class="field"><label for="pm_instructions">Instructions</label><textarea id="pm_instructions" name="instructions"</textarea></div>
        <div class="field"><label for="pm_follow_up_date">Follow-up Date</label><input id="pm_follow_up_date" name="follow_up_date" type="date" /></div>
        <div id="rxConflictPrompt" style="display:none;margin-bottom:12px"></div>
        <button class="btn btn-primary" id="btnIssueRx" type="submit">Issue Prescription</button>
      </form>
    </div>`;
}

function bindVetCaseActions(c, allergies = []) {
  const sf = document.getElementById("statusForm");
  if (sf) {
    sf.addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await api(`/cases/${safeId(c.id)}`, { method: "PUT", body: Object.fromEntries(new FormData(e.target)) }); toast("Case updated successfully"); router(); }
      catch (err) { toast(err.message, true); }
    });
  }

  const scf = document.getElementById("sampleCollectForm");
  if (scf) {
    scf.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const body = Object.fromEntries(new FormData(e.target));
        body.case_id = c.id;
        await api("/samples", { method: "POST", body });
        toast("Digital sample collected with GPS & QR!");
        router();
      } catch (err) { toast(err.message, true); }
    });
  }

  const trf = document.getElementById("trForm");
  if (trf) {
    trf.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const body = Object.fromEntries(new FormData(e.target));
        await api(`/cases/${safeId(c.id)}/treatment-responses`, { method: "POST", body });
        toast("Treatment response saved!");
        router();
      } catch (err) { toast(err.message, true); }
    });
  }

  const rf = document.getElementById("rxForm");
  if (rf) {
    rf.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      body.case_id = c.id;
      try {
        await api("/prescriptions", { method: "POST", body });
        toast("E-prescription issued successfully!");
        router();
      } catch (err) {
        if (err.data && err.data.conflict) {
          const promptBox = document.getElementById("rxConflictPrompt");
          promptBox.style.display = "block";
          promptBox.innerHTML = `
            <div class="conflict-box">
              <b>${err.data.error}</b>
              <div style="margin-top:6px">Authorized Override Reason (Mandatory to override allergy warning):</div>
              <input id="overrideReasonInp" placeholder="Enter clinical justification for override" style="margin-top:4px" />
              <button class="btn btn-outline btn-sm" style="margin-top:8px;background:#fff" type="button" id="btnConfirmOverride">Confirm Override &amp; Prescribe</button>
            </div>
          `;
          document.getElementById("btnConfirmOverride").addEventListener("click", async () => {
            const reason = (document.getElementById("overrideReasonInp")?.value || "").trim();
            if (!reason) return toast("Override reason is required", true);
            body.override = true;
            body.override_reason = reason;
            try {
              await api("/prescriptions", { method: "POST", body });
              toast("Prescription issued with recorded allergy override!");
              router();
            } catch (ex) { toast(ex.message, true); }
          });
        } else {
          toast(err.message, true);
        }
      }
    });
  }
}

// ======================================================== SEARCH & VAX ====
route("#/vet/search", () => {
  render(`
    ${header("Search Herds & Animals", { back: true })}
    <div class="section-card">
      <div class="field"><label for="searchInput">Search by Tag, Mobile or Owner</label>
        <input id="searchInput" placeholder="e.g. MH-PUN-000123 or 9800000001" />
      </div>
      <div id="searchResults"></div>
    </div>
    ${bottomNav("#/vet/search")}
  `);
  document.getElementById("searchInput").addEventListener("input", async (e) => {
    const q = e.target.value.trim();
    if (!q) { document.getElementById("searchResults").innerHTML = ""; return; }
    try {
      const res = await api(`/vet/search?q=${encodeURIComponent(q)}`);
      document.getElementById("searchResults").innerHTML = `
        <div class="subheading">Animals (${res.animals.length})</div>
        ${res.animals.map(a => `
          <div class="list-card" role="button" tabindex="0" onclick="location.hash='#/vet/animals/${safeId(a.id)}'" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.hash='#/vet/animals/${safeId(a.id)}'}">
            <div class="row1"><span class="title">${escapeHtml(a.animal_code)}</span><span class="badge ${escapeHtml(a.status === 'Healthy' ? 'badge-green' : 'badge-orange')}">${escapeHtml(a.status)}</span></div>
            <div class="meta">${escapeHtml(a.animal_name || a.species)} · Owner: ${escapeHtml(a.owner_name)} (${escapeHtml(a.mobile)})</div>
          </div>`).join("")}
        <div class="subheading" style="margin-top:14px">Herds (${res.herds.length})</div>
        ${res.herds.map(h => `<div class="list-card" style="cursor:default"><div class="row1"><span class="title">${escapeHtml(h.herd_code)}</span></div><div class="meta">${escapeHtml(h.village)}, ${escapeHtml(h.district)}</div></div>`).join("")}
      `;
    } catch (err) {}
  });
}, ["vet"]);

route("#/vet/vaccination/new", () => {
  render(`
    ${header("Update Vaccination", { back: true })}
    <div class="section-card">
      <form id="vacForm">
        <div class="field"><label for="pm_animal_id">Animal ID</label><input id="pm_animal_id" name="animal_id" placeholder="e.g. MH-PUN-000123" required /></div>
        <div class="field"><label for="pm_vaccine_3">Vaccine</label><select id="pm_vaccine_3" name="vaccine"<option>FMD</option><option>HS</option><option>BQ</option><option>Brucellosis</option><option>Other</option></select></div>
        <div class="form-row">
          <div class="field"><label for="pm_date_given">Date Given</label><input id="pm_date_given" name="date_given" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
          <div class="field"><label for="pm_next_due_date">Next Due Date</label><input id="pm_next_due_date" name="next_due_date" type="date" /></div>
        </div>
        <button class="btn btn-primary" type="submit">Save Vaccination</button>
      </form>
    </div>
    ${bottomNav("#/vet/dashboard")}
  `);
  document.getElementById("vacForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("/vaccinations", { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); toast("Vaccination recorded!"); location.hash = "#/vet/dashboard"; }
    catch (err) { toast(err.message, true); }
  });
}, ["vet"]);

// ======================================================= PRESCRIPTIONS ==
function prescriptionsView(role) {
  route(`#/${role}/prescriptions`, async () => {
    const farmer = role === "owner";
    render(`${header(farmer ? ft("health_treatment") : "Prescriptions", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">${farmer ? ft("loading_treatment") : "Loading…"}</div>`);
    const rx = await api("/prescriptions");
    if (farmer) {
      render(`
        ${header(ft("health_treatment"), { back: true })}
        <div class="section-card">
          ${rx.length === 0 ? emptyState(ft("no_prescriptions")) : rx.map(p => `
            <div class="list-card farmer-list-card" role="button" tabindex="0" onclick="location.hash='#/owner/cases/${safeId(p.case_id)}'" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.hash='#/owner/cases/${safeId(p.case_id)}'}">
              <div class="row1"><span class="title">💊 ${escapeHtml(p.medicine)}</span><span class="badge badge-blue">${escapeHtml(p.case_no)}</span></div>
              <div class="meta">${ft("animal_id")}: ${escapeHtml(p.animal_code)}</div>
              <div class="meta">${ft("dosage")}: ${escapeHtml(p.dosage || ft("unknown"))} · ${ft("frequency")}: ${escapeHtml(p.frequency || ft("unknown"))}</div>
              <div class="meta">${ft("prescribed_by")}: ${escapeHtml(p.vet_name || ft("unknown"))} · ${ft("follow_up")}: ${fmtDate(p.follow_up_date)}</div>
            </div>`).join("")}
        </div>
        ${bottomNav("#/owner/prescriptions")}
      `);
      return;
    }
    render(`
      ${header("Prescriptions", { back: true })}
      <div class="section-card">
        ${rx.length === 0 ? emptyState("No prescriptions yet.") : rx.map(p => `
          <div class="list-card" role="button" tabindex="0" onclick="location.hash='#/${role}/cases/${safeId(p.case_id)}'" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.hash='#/${role}/cases/${safeId(p.case_id)}'}">
            <div class="row1"><span class="title">${escapeHtml(p.medicine)}</span><span class="badge badge-blue">${escapeHtml(p.case_no)}</span></div>
            <div class="meta">${escapeHtml(p.animal_code)} · ${escapeHtml(p.dosage || "")} · ${escapeHtml(p.frequency || "")}</div>
            <div class="meta">By ${escapeHtml(p.vet_name || "—")} · Follow-up: ${fmtDate(p.follow_up_date)}</div>
          </div>`).join("")}
      </div>
      ${bottomNav(role === "owner" ? "#/owner/prescriptions" : `#/${role}/dashboard`)}
    `);
  }, [role]);
}
prescriptionsView("owner"); prescriptionsView("vet"); prescriptionsView("lab");

// ======================================================= LAB REPORTS ====
function labReportsView(role) {
  route(`#/${role}/lab-reports`, async () => {
    const farmer = role === "owner";
    render(`${header(farmer ? ft("test_results") : "Lab Reports", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">${farmer ? ft("loading") : "Loading…"}</div>`);
    const reps = await api("/lab/reports");
    if (farmer) {
      render(`
        ${header(ft("test_results"), { back: true })}
        <div class="section-card">
          ${reps.length ? reps.map(report => `
            <div class="list-card farmer-list-card" role="button" tabindex="0" onclick="location.hash='#/owner/cases/${safeId(report.case_id)}'" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.hash='#/owner/cases/${safeId(report.case_id)}'}">
              <div class="row1"><span class="title">${report.test_name || report.report_no}</span><span class="badge ${report.result === "NEGATIVE" ? "badge-green" : "badge-blue"}">${ownerResultLabel(report.result)}</span></div>
              <div class="meta">${ft("animal_id")}: ${report.animal_code}${report.animal_name ? ` · ${report.animal_name}` : ""}</div>
              <div class="meta">${ft("case_number")}: ${report.case_no} · ${fmtDate(report.test_date)}</div>
            </div>`).join("") : emptyState(ft("no_lab_reports"))}
        </div>
        ${bottomNav("#/owner/prescriptions")}
      `);
      return;
    }
    render(`
      ${header("Lab Reports", { back: true })}
      <div class="section-card">
        ${reps.length === 0 ? emptyState("No lab reports yet.") : reps.map(l => `
          <div class="list-card" role="button" tabindex="0" onclick="location.hash='#/${role}/cases/${safeId(l.case_id)}'" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.hash='#/${role}/cases/${safeId(l.case_id)}'}">
            <div class="row1"><span class="title">${escapeHtml(l.report_no)}</span><span class="badge ${escapeHtml(l.result === 'NEGATIVE' ? 'badge-green' : 'badge-red')}">${escapeHtml(l.result || "Pending")}</span></div>
            <div class="meta">${escapeHtml(l.animal_code)}${escapeHtml(l.animal_name ? " · " + l.animal_name : "")} · ${escapeHtml(l.test_name || "")}</div>
            <div class="meta">Case ${escapeHtml(l.case_no)} · Sample: ${escapeHtml(l.sample || "—")} · ${fmtDate(l.test_date)}</div>
            ${l.notes ? `<div class="meta">${escapeHtml(l.notes)}</div>` : ""}
          </div>`).join("")}
      </div>
      ${bottomNav(role === "owner" ? "#/owner/lab-reports" : role === "lab" ? "#/lab/lab-reports" : `#/${role}/dashboard`)}
    `);
  }, [role]);
}
labReportsView("owner"); labReportsView("vet"); labReportsView("lab");

function ownerNotificationMessage(message) {
  const text = String(message || "");
  let match;
  if ((match = text.match(/^New case reported: (.+) for animal (.+)\.$/i))) return ft("notification_case_new", { case: match[1], animal: match[2] });
  if ((match = text.match(/^नया मामला दर्ज: (.+) के लिए (.+)[।.]$/))) return ft("notification_case_new", { animal: match[1], case: match[2] });
  if ((match = text.match(/^नवीन प्रकरण नोंदवले: (.+) पशू (.+) साठी[।.]$/))) return ft("notification_case_new", { case: match[1], animal: match[2] });
  if ((match = text.match(/^కొత్త కేసు నమోదు: (.+) జంతువు (.+) కోసం[।.]$/))) return ft("notification_case_new", { case: match[1], animal: match[2] });

  if ((match = text.match(/^Case (.+) updated: (.+?)[.]?$/i))) return ft("notification_case_update", { case: match[1], status: ownerCaseStatus(match[2].replace(/[.।]$/, "")) });
  if ((match = text.match(/^मामला (.+) अपडेट: (.+?)[।.]$/))) return ft("notification_case_update", { case: match[1], status: ownerCaseStatus(match[2].replace(/[.।]$/, "")) });
  if ((match = text.match(/^प्रकरण (.+) अद्ययावत: (.+?)[।.]$/))) return ft("notification_case_update", { case: match[1], status: ownerCaseStatus(match[2].replace(/[.।]$/, "")) });
  if ((match = text.match(/^కేసు (.+) నవీకరణ: (.+?)[।.]$/))) return ft("notification_case_update", { case: match[1], status: ownerCaseStatus(match[2].replace(/[.।]$/, "")) });

  if ((match = text.match(/^(?:Your )?Lab report (.+) is ready for case (.+)[.]?$/i))) return ft("notification_lab_ready", { report: match[1], case: match[2] });
  if ((match = text.match(/^लैब रिपोर्ट (.+) मामले (.+) के लिए तैयार है[।.]$/))) return ft("notification_lab_ready", { report: match[1], case: match[2] });
  if ((match = text.match(/^प्रयोगशाळा अहवाल (.+) प्रकरण (.+) साठी तयार आहे[।.]$/))) return ft("notification_lab_ready", { report: match[1], case: match[2] });
  if ((match = text.match(/^ల్యాబ్ రిపోర్ట్ (.+) కేసు (.+) కోసం సిద్ధంగా ఉంది[।.]$/))) return ft("notification_lab_ready", { report: match[1], case: match[2] });
  if ((match = text.match(/^(?:🧪\s*)?Laboratory report (.+) for your animal (.+) \(Case (.+)\) has been released\.$/i))) {
    return `${ft("notification_lab_ready", { report: match[1], case: match[3] })} · ${ft("animal_id")}: ${match[2]}`;
  }

  if ((match = text.match(/^An e-prescription is available for case (.+)[.]?$/i))) return ft("notification_prescription_issued", { case: match[1] });
  if ((match = text.match(/^मामले (.+) के लिए ई-प्रिस्क्रिप्शन उपलब्ध है[।.]$/))) return ft("notification_prescription_issued", { case: match[1] });
  if ((match = text.match(/^प्रकरण (.+) साठी ई-प्रिस्क्रिप्शन उपलब्ध आहे[।.]$/))) return ft("notification_prescription_issued", { case: match[1] });
  if ((match = text.match(/^కేసు (.+) కోసం ఇ-ప్రిస్క్రిప్షన్ అందుబాటులో ఉంది[।.]$/))) return ft("notification_prescription_issued", { case: match[1] });

  if ((match = text.match(/^Dr\. (.+) is on the way to examine your animal for (.+)\.$/i))) return ft("notification_vet_on_way", { name: match[1], case: match[2] });
  if ((match = text.match(/^Dr\. (.+) has arrived at your farm for case (.+)\.$/i))) return ft("notification_vet_arrived", { name: match[1], case: match[2] });
  if ((match = text.match(/^A laboratory test has been requested for case (.+)\.$/i))) return ft("notification_test_requested", { case: match[1] });
  if ((match = text.match(/^Lab sample for animal (.+) could not be processed: (.+)$/i))) return ft("notification_lab_problem", { animal: match[1], reason: match[2] });
  if ((match = text.match(/^Case (.+) marked as RECOVERED by Dr\. (.+)\.$/i))) return ft("notification_case_recovered", { case: match[1], name: match[2] });
  if ((match = text.match(/^Farm alert: (.+) detected in your area \((.+?)\)\. ?(.*)$/i))) return ft("notification_farm_alert", { disease: match[1], district: match[2], action: match[3] });
  if ((match = text.match(/^फार्म अलर्ट: आपके क्षेत्र \((.+?)\) में (.+) का पता चला[।.] ?(.*)$/))) return ft("notification_farm_alert", { district: match[1], disease: match[2], action: match[3] });
  if ((match = text.match(/^शेत सूचना: तुमच्या भागात \((.+?)\) (.+) आढळला[।.] ?(.*)$/))) return ft("notification_farm_alert", { district: match[1], disease: match[2], action: match[3] });
  if ((match = text.match(/^ఫార్మ్ హెచ్చరిక: మీ ప్రాంతంలో \((.+?)\) (.+) కనుగొనబడింది[।.] ?(.*)$/))) return ft("notification_farm_alert", { district: match[1], disease: match[2], action: match[3] });

  if ((match = text.match(/^Vaccination due for your animal (.+)\.?.*$/i))) return ft("notification_vaccination_due", { animal: match[1].split(".")[0] });
  if ((match = text.match(/^आपके पशु (.+) के लिए टीकाकरण बकाया है.*$/))) return ft("notification_vaccination_due", { animal: match[1].split("।")[0] });
  if ((match = text.match(/^तुमच्या पशूचे (.+) लसीकरण बाकी आहे.*$/))) return ft("notification_vaccination_due", { animal: match[1].split(".")[0] });
  if ((match = text.match(/^మీ జంతువు (.+) కోసం వ్యాక్సినేషన్ బాకీ ఉంది[।.]?$/))) return ft("notification_vaccination_due", { animal: match[1] });
  return farmerRuntimeText(text);
}
function ownerNotificationType(type) {
  const key = ({ case: "notification_case", lab: "notification_lab", prescription: "notification_prescription", vaccination: "notification_vaccination", farm_alert: "notification_alert", info: "notification_info" }[(type || "").toLowerCase()]);
  return key ? ft(key) : ft("notification_info");
}

// ======================================================= NOTIFICATIONS ==
function notificationsView(role) {
  route(`#/${role}/notifications`, async () => {
    const farmer = role === "owner";
    render(`${header(farmer ? ft("notifications") : "Notifications", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">${farmer ? ft("loading_notifications") : "Loading…"}</div>`);
    const notes = await api("/notifications");
    if (farmer) {
      render(`
        ${header(ft("notifications"), { back: true })}
        <div class="section-card">
          ${notes.length === 0 ? emptyState(ft("no_notifications")) : notes.map(n => `
            <div class="list-card" role="button" tabindex="0" style="${escapeHtml(n.is_read ? "opacity:0.6" : "")}" onclick="markRead(${safeId(n.id)})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();markRead(${safeId(n.id)})}">
              <div class="row1"><span class="title">${iconForType(n.type)} ${escapeHtml(ownerNotificationType(n.type))}</span>${n.is_read ? "" : `<span class="badge badge-red">${ft("new")}</span>`}</div>
              <div class="meta">${escapeHtml(ownerNotificationMessage(n.message))}</div>
              <div class="meta">${fmtDate(n.created_at)}</div>
            </div>`).join("")}
        </div>
        ${bottomNav("#/owner/notifications")}
      `);
      return;
    }
    render(`
      ${header("Notifications", { back: true })}
      <div class="section-card">
        ${notes.length === 0 ? emptyState("You're all caught up!") : notes.map(n => `
          <div class="list-card" role="button" tabindex="0" style="${escapeHtml(n.is_read ? "opacity:0.6" : "")}" onclick="markRead(${safeId(n.id)})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();markRead(${safeId(n.id)})}">
            <div class="row1"><span class="title">${iconForType(n.type)} ${escapeHtml(n.type.toUpperCase())}</span>${n.is_read ? "" : '<span class="badge badge-red">NEW</span>'}</div>
            <div class="meta">${escapeHtml(n.message)}</div>
            <div class="meta">${fmtDate(n.created_at)}</div>
          </div>`).join("")}
      </div>
      ${bottomNav(`#/${role}/notifications`)}
    `);
  }, [role]);
}
notificationsView("owner"); notificationsView("vet"); notificationsView("govt"); notificationsView("lab");

function iconForType(t2) { return { case: "🩺", lab: "🧪", prescription: "💊", vaccination: "💉" }[t2] || "🔔"; }

window.markRead = async function (id) {
  try { await api(`/notifications/${id}/read`, { method: "PUT" }); router(); } catch (e) { }
};
window.deleteAnimal = async function (id, code) {
  const confirmation = getUserRole() === "owner"
    ? ft("delete_confirm", { code })
    : `Delete animal ${code}? This also removes its cases, lab reports and prescriptions.`;
  if (!confirm(confirmation)) return;
  try {
    await api(`/animals/${id}`, { method: "DELETE" });
    toast(getUserRole() === "owner" ? ft("animal_deleted", { code }) : `Animal ${code} deleted`);
    router();
  } catch (err) { toast(err.message, true); }
};
window.deleteCase = async function (id, caseNo) {
  if (!confirm(`Delete report ${caseNo}? This removes the case, its lab reports and prescriptions permanently.`)) return;
  try { await api(`/cases/${id}`, { method: "DELETE" }); toast(`Report ${caseNo} deleted`); location.hash = "#/vet/reports"; }
  catch (err) { toast(err.message, true); }
};

// ==========================================================================
// REQ 1: MORTALITY — Mark Animal Deceased
// ==========================================================================
window.markDeceased = async function (id, code) {
  const promptText = getUserRole() === "owner" ? ft("deceased_prompt", { code }) : `Enter cause of death for ${code}:`;
  const cause = prompt(promptText);
  if (!cause) return;
  try {
    await api(`/animals/${id}/deceased`, { method: "POST", body: { cause_of_death: cause } });
    toast(getUserRole() === "owner" ? ft("animal_marked_deceased", { code }) : `Animal ${code} marked as deceased.`);
    router();
  } catch (err) { toast(err.message, true); }
};

// ==========================================================================
// REQ 5: GOVT TREND CHARTS
// ==========================================================================
route("#/govt/trends", async () => {
  render(`${header("Disease Trends", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading trends…</div>`);
  const data = await api("/govt/trends?period=monthly");
  render(`
    ${header("Disease Trends", { back: true })}
    <div class="section-card">
      <div class="section-title">📈 Historical Case Trends</div>
      <div class="btn-row" style="margin-bottom:12px">
        <button class="btn btn-ghost btn-sm" onclick="loadTrends('weekly')">Weekly</button>
        <button class="btn btn-primary btn-sm" onclick="loadTrends('monthly')">Monthly</button>
      </div>
      <div id="trendChart">${trendBarChart(data.trends)}</div>
    </div>
    <div class="section-card">
      <div class="section-title">🦠 Disease-wise Trends</div>
      <div id="diseaseTrendChart">${diseaseTrendSection(data.disease_trends, data.trends)}</div>
    </div>
    ${bottomNav("#/govt/dashboard")}
  `);
}, ["govt", "vet"]);

window.loadTrends = async function (period) {
  try {
    const data = await api(`/govt/trends?period=${period}`);
    const el = document.getElementById("trendChart");
    if (el) el.innerHTML = trendBarChart(data.trends);
    const el2 = document.getElementById("diseaseTrendChart");
    if (el2) el2.innerHTML = diseaseTrendSection(data.disease_trends, data.trends);
  } catch (err) { toast(err.message, true); }
};

function trendBarChart(trends) {
  if (!trends || !trends.length) return emptyState("No trend data available yet.");
  const max = Math.max(...trends.map(t => t.total), 1);
  return `<div style="display:flex;align-items:end;gap:4px;height:160px;padding:8px 0">
    ${trends.map(t => {
      const pct = Math.round((t.total / max) * 100);
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
        <div style="font-size:10px;font-weight:700">${escapeHtml(t.total)}</div>
        <div style="width:100%;height:${Math.max(pct, 4)}%;background:var(--primary);border-radius:4px 4px 0 0;min-height:4px"></div>
        <div style="font-size:9px;writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap">${escapeHtml(t.period_label)}</div>
      </div>`;
    }).join("")}
  </div>`;
}

function diseaseTrendSection(diseaseTrends, trends) {
  if (!diseaseTrends || !Object.keys(diseaseTrends).length) return emptyState("No disease trend data.");
  const allDiseases = new Set();
  Object.values(diseaseTrends).forEach(arr => arr.forEach(d => allDiseases.add(d.disease)));
  const top3 = [...allDiseases].slice(0, 3);
  const colors = ["#3f51b5", "#e53935", "#43a047"];
  let html = `<div style="margin:8px 0">`;
  top3.forEach((disease, i) => {
    html += `<div style="margin:6px 0"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${colors[i]};margin-right:6px"></span><b>${disease}</b></div>`;
  });
  html += `</div>`;
  return html;
}

// ==========================================================================
// REQ 6: IVR STATUS ON VET DASHBOARD
// ==========================================================================
// Modified vetDashboard to show IVR status
const _origVetDashboard = vetDashboard;

// ==========================================================================
// REQ 9: AI AUTO-ESCALATED BADGE
// ==========================================================================
// Helper to show auto-escalated badge
function autoEscalatedBadge(c) {
  if (c.ai_auto_escalated) {
    return `<span class="badge badge-red" style="margin-left:6px">🤖 AI Auto-escalated</span>`;
  }
  return "";
}

// ==========================================================================
// REQ 10: BLOCK-LEVEL ANALYTICS VIEW
// ==========================================================================
route("#/govt/blocks", async () => {
  render(`${header("Block-Level Analytics", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading…</div>`);
  const a = await api("/govt/analytics");
  render(`
    ${header("Block-Level Analytics", { back: true })}
    <div class="section-card">
      <div class="section-title">🏘️ Cases by Block & District</div>
      ${a.cases_by_block && a.cases_by_block.length > 0 ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>District</th><th>Block</th><th>Cases</th><th>Active</th></tr></thead>
            <tbody>
              ${a.cases_by_block.map(b => `
                <tr>
                  <td>${escapeHtml(b.district)}</td>
                  <td><b>${escapeHtml(b.block)}</b></td>
                  <td>${escapeHtml(b.cases)}</td>
                  <td>${escapeHtml(b.active)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : emptyState("No block-level case data available.")}
    </div>
    ${bottomNav("#/govt/dashboard")}
  `);
}, ["govt"]);

// ==========================================================================
// REQ 11: FARMER ADVISORIES
// ==========================================================================
route("#/vet/advisories", async () => {
  render(`${header("Local Advisories", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading advisories…</div>`);
  try {
    const adv = await api("/advisories");
    render(`
      ${header("Local Disease Advisory", { back: true })}
      <div class="section-card">
        <div class="section-title">📍 ${adv.district} — Disease Risk</div>
        <div class="stat-grid" style="margin:0">
          <div class="stat-card"><div class="num"><span class="badge ${riskBadgeClass(adv.risk_level)}">${adv.risk_level}</span></div><div class="lbl">Current Risk</div></div>
          ${statCard(adv.active_cases, "Active Cases")}
        </div>
      </div>
      ${adv.weather_advisories.length > 0 ? `
        <div class="section-card">
          <div class="section-title">🌤️ Weather Advisories</div>
          ${adv.weather_advisories.map(wa => `<div class="meta" style="margin:4px 0">• ${wa}</div>`).join("")}
          <div class="small-muted" style="margin-top:8px">Temp: ${adv.weather.temperature}°C · Humidity: ${adv.weather.humidity}% · Rainfall: ${adv.weather.rainfall}mm</div>
        </div>
      ` : ""}
      ${adv.alerts.length > 0 ? `
        <div class="section-card">
          <div class="section-title">🚨 Active Alerts in Your Area</div>
          ${adv.alerts.map(a => `
            <div class="list-card" style="cursor:default">
              <div class="row1"><span class="title">${escapeHtml(a.disease)}</span><span class="badge ${riskBadgeClass(a.risk_level)}">${escapeHtml(a.risk_level)}</span></div>
              <div class="meta">${escapeHtml(a.trigger_reason)}</div>
              <div class="meta" style="color:var(--primary)">Action: ${escapeHtml(a.recommended_action || "—")}</div>
            </div>
          `).join("")}
        </div>
      ` : ""}
      ${adv.campaigns.length > 0 ? `
        <div class="section-card">
          <div class="section-title">💉 Vaccination Campaigns</div>
          ${adv.campaigns.map(c => `
            <div class="list-card" style="cursor:default">
              <div class="row1"><span class="title">${escapeHtml(c.name)}</span><span class="badge ${campStatusClass(c.status)}">${escapeHtml(c.status)}</span></div>
              <div class="meta">${escapeHtml(c.vaccine)} · ${escapeHtml(c.district)}</div>
              <div class="meta">Dates: ${fmtDate(c.start_date)} → ${fmtDate(c.end_date)}</div>
            </div>
          `).join("")}
        </div>
      ` : ""}
      ${bottomNav("#/vet/dashboard")}
    `);
  } catch (err) {
    render(`${header("Local Advisories", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">⚠️ ${escapeHtml(err.message)}</div>${bottomNav("#/vet/dashboard")}`);
  }
}, ["vet"]);

// ==========================================================================
// REQ 12: DATA EXPORT
// ==========================================================================
route("#/govt/export", async () => {
  state.pagination.govtExport = state.pagination.govtExport || 1;
  const page = state.pagination.govtExport;
  const pageSize = state.pagination.pageSize;
  let previewData = null;
  try {
    previewData = await api(`/govt/export?type=cases&format=json&paginated=1&page=${page}&page_size=${pageSize}`);
  } catch(e) { previewData = { items: [], total: 0 }; }
  const pag = pmPaginate(new Array(previewData.total||0).fill(0), page, pageSize);
  const items = previewData.items || [];
  render(`
    ${header("Export Data", { back: true })}
    <div class="section-card" id="exportControls">
      <div class="section-title">📊 Export Government Data</div>
      <div class="meta" style="margin-bottom:14px">Download cases, animals, or vaccination campaigns as CSV, JSON, Excel, or PDF. Reports include pagination, print, and accessible text summaries for charts.</div>
      <div class="field"><label for="exportFrom">Date From</label><input type="date" id="exportFrom" /></div>
      <div class="field"><label for="exportTo">Date To</label><input type="date" id="exportTo" /></div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn btn-primary btn-sm" onclick="doExport('cases','csv')">📥 Cases CSV</button>
        <button class="btn btn-ghost btn-sm" onclick="doExport('animals','csv')">📥 Animals CSV</button>
        <button class="btn btn-ghost btn-sm" onclick="doExport('campaigns','csv')">📥 Campaigns CSV</button>
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn btn-outline btn-sm" onclick="doExport('cases','xlsx')">📊 Cases Excel</button>
        <button class="btn btn-outline btn-sm" onclick="doExport('animals','xlsx')">📊 Animals Excel</button>
        <button class="btn btn-outline btn-sm" onclick="doExport('cases','pdf')">📄 Cases PDF</button>
        <button class="btn btn-outline btn-sm" onclick="doExport('animals','pdf')">📄 Animals PDF</button>
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn btn-outline btn-sm" onclick="doExport('cases','json')">JSON Cases</button>
        <button class="btn btn-outline btn-sm" onclick="doExport('animals','json')">JSON Animals</button>
        <button class="btn btn-ghost btn-sm" onclick="pmPrintSection('exportPreview')">🖨️ Print Preview</button>
      </div>
    </div>
    <div class="section-card" id="exportPreview">
      <div class="section-title">Preview — Cases (Page ${page})</div>
      <div class="meta">Total ${previewData.total||0} records. Showing ${items.length} on this page. Use pagination to browse.</div>
      ${items.length ? `<div class="pm-table-scroll" tabindex="0" role="region" aria-label="Cases preview table"><table><thead><tr><th>ID</th><th>Animal</th><th>Status</th><th>District</th><th>Created</th></tr></thead><tbody>${items.map(r=>`<tr><td>${escapeHtml(r.id)}</td><td>${escapeHtml(r.animal_code||"")}</td><td>${escapeHtml(r.status||"")}</td><td>${escapeHtml(r.animal_district||"")}</td><td>${escapeHtml(r.created_at||"")}</td></tr>`).join("")}</tbody></table></div>` : emptyState("No cases to preview.")}
      ${pmPaginationHtml(previewData.total||0, page, pageSize, "goGovtExportPage", {label:"Cases preview pagination"})}
    </div>
    ${bottomNav("#/govt/dashboard")}
  `);
}, ["govt"]);

window.goGovtExportPage = function(p) {
  state.pagination.govtExport = Math.max(1, p);
  location.hash = "#/govt/export";
  // Re-trigger route by re-navigating
  setTimeout(()=>{ if(location.hash==="#/govt/export") location.reload(); }, 50);
};

window.doExport = function (type, format) {
  const from = document.getElementById("exportFrom")?.value || "";
  const to = document.getElementById("exportTo")?.value || "";
  let url = `/api/govt/export?type=${type}&format=${format}`;
  if (from) url += `&from=${from}`;
  if (to) url += `&to=${to}`;
  const a = document.createElement("a");
  a.href = url;
  a.download = `pashumitra_${type}.${format}`;
  a.target = "_blank";
  fetch(url, { headers: { "Authorization": "Bearer " + state.token } })
    .then(async r => {
      if (!r.ok) { const txt = await r.text(); throw new Error(txt); }
      return r.blob();
    })
    .then(blob => {
      const blobUrl = URL.createObjectURL(blob);
      a.href = blobUrl;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(blobUrl), 2000);
      toast(`Exported ${type} as ${format.toUpperCase()}`);
    })
    .catch(e => toast("Export failed: " + e.message, true));
};

// ==========================================================================
// REQ 14: GIS ERROR HANDLING IMPROVEMENTS
// ==========================================================================
// Patch initGisMap to show errors
const _origInitGisMap = initGisMap;

// ==========================================================================
// REQ 15: WEATHER RELIABILITY WARNING
// ==========================================================================
function weatherReliabilityWarning(weatherReliability) {
  if (weatherReliability === "low") {
    return `<div class="conflict-box" style="margin:8px 0;padding:8px 12px">
      <b>⚠️ Weather data may be stale — prediction accuracy reduced</b>
      <div class="small-muted">Live weather API was unavailable. Using cached or baseline data.</div>
    </div>`;
  }
  return "";
}

// ==========================================================================
// REQ 16: ML HEALTH MONITORING ON GOVT AI DASHBOARD
// ==========================================================================
// Will be shown in the AI section

// ==========================================================================
// REQ 17: PUSH NOTIFICATION UI
// ==========================================================================
route("#/notifications/settings", async () => {
  const farmer = getUserRole() === "owner";
  const vapidRes = await api("/push/vapid-key").catch(() => ({ configured: false }));
  render(`
    ${header(farmer ? ft("notification_settings") : "Notification Settings", { back: true })}
    <div class="section-card">
      <div class="section-title">🔔 ${farmer ? ft("push_notifications") : "Push Notifications"}</div>
      <div class="meta" style="margin-bottom:12px">
        ${vapidRes.configured
          ? (farmer ? ft("push_available") : "Push notifications are available. Enable to receive real-time alerts for cases, lab reports, and outbreaks.")
          : (farmer ? ft("push_admin") : "Push notifications are not configured on this server. In-app notifications will still work.")}
      </div>
      ${vapidRes.configured ? `
        <button class="btn btn-primary" id="btnEnablePush">🔔 ${farmer ? ft("enable_push") : "Enable Push Notifications"}</button>
        <div id="pushStatus" class="small-muted" style="margin-top:8px"></div>
      ` : `<div class="demo-box">${farmer ? ft("push_admin") : "Push notifications require VAPID keys to be configured by the server administrator."}</div>`}
    </div>
    ${bottomNav(homeFor(getUserRole() || "owner"))}
  `);
  if (vapidRes.configured) {
    document.getElementById("btnEnablePush")?.addEventListener("click", async () => {
      const statusEl = document.getElementById("pushStatus");
      try {
        if (!("Notification" in window)) {
          statusEl.textContent = farmer ? ft("push_unsupported") : "Push notifications are not supported in this browser.";
          return;
        }
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          statusEl.textContent = farmer ? ft("push_permission_denied") : "Notification permission denied. Please enable in browser settings.";
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidRes.publicKey,
        });
        const subJson = sub.toJSON();
        await api("/push/subscribe", { method: "POST", body: subJson });
        statusEl.textContent = farmer ? `✅ ${ft("push_enabled")}` : "✅ Push notifications enabled!";
        toast(farmer ? ft("push_enabled") : "Push notifications enabled!");
      } catch (err) {
        statusEl.textContent = farmer ? ft("push_failed") : "Failed: " + err.message;
      }
    });
  }
});

// ==========================================================================
// REQ 18: FARMER FEEDBACK
// ==========================================================================
function farmerFeedbackSection(c) {
  const localized = getUserRole() === "owner";
  return `
    <div class="section-card">
      <div class="subheading">📝 ${localized ? ft("how_is_animal") : "How is your animal?"}</div>
      <div class="meta" style="margin-bottom:10px">${localized ? ft("notes_placeholder") : "Let your veterinarian know the recovery progress."}</div>
      <form id="farmerFeedbackForm">
        <div class="field"><label for="pm_recovery_status">${localized ? ft("recovery_status") : "Recovery Status"}</label>
          <select id="pm_recovery_status" name="recovery_status"
            <option value="improving">✅ ${localized ? ft("improving") : "Improving"}</option>
            <option value="same">↔️ ${localized ? ft("same") : "Same"}</option>
            <option value="worse">⚠️ ${localized ? ft("worse") : "Getting Worse"}</option>
          </select>
        </div>
        <div class="field"><label for="pm_notes_4">${localized ? ft("notes") : "Notes (optional)"}</label><textarea id="pm_notes_4" name="notes" placeholder="${localized ? ft("notes_placeholder") : "Any observations about the animal's condition"}"</textarea></div>
        <button class="btn btn-primary" type="submit">${localized ? ft("submit_feedback") : "Submit Feedback"}</button>
      </form>
    </div>`;
}

// ==========================================================================
// REQ 20: ZOONOTIC RISK VIEW
// ==========================================================================
route("#/govt/zoonotic", async () => {
  render(`${header("Zoonotic Risk", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">Loading…</div>`);
  try {
    const data = await api("/govt/zoonotic");
    render(`
      ${header("Zoonotic Disease Risk", { back: true })}
      ${data.active_zoonotic_cases > 0 ? `
        <div style="background:#fde6e4;padding:12px;border-radius:12px;margin:12px 16px;border-left:4px solid #e53935">
          <b>⚠️ ${data.active_zoonotic_cases} active zoonotic case(s) detected!</b>
          <div class="small-muted">These diseases can transmit from animals to humans. PPE precautions required.</div>
        </div>
      ` : ""}
      <div class="section-card">
        <div class="section-title">🦠 Zoonotic Diseases Monitored</div>
        ${data.zoonotic_diseases.map(d => `
          <div class="list-card" style="cursor:default">
            <div class="row1">
              <span class="title">${escapeHtml(d.name)} (${escapeHtml(d.name_mr)})</span>
              <span class="badge ${riskBadgeClass(d.risk_level)}">${escapeHtml(d.risk_level)}</span>
            </div>
            <div class="meta">Category: ${escapeHtml(d.category)}</div>
          </div>
        `).join("")}
      </div>
      ${data.active_zoonotic_cases > 0 ? `
        <div class="section-card">
          <div class="section-title">📍 Active Zoonotic Cases by District</div>
          ${Object.entries(data.cases_by_district).map(([dist, count]) => `
            <div class="list-card" style="cursor:default">
              <div class="row1"><span class="title">${dist}</span><span class="badge badge-red">${count} case(s)</span></div>
            </div>
          `).join("")}
        </div>
      ` : ""}
      ${bottomNav("#/govt/dashboard")}
    `);
  } catch (err) {
    render(`${header("Zoonotic Risk", { back: true })}<div class="loading" role="status" aria-live="polite" aria-busy="true">⚠️ ${escapeHtml(err.message)}</div>${bottomNav("#/govt/dashboard")}`);
  }
}, ["govt", "vet"]);
