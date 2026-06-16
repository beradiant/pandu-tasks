// =====================================================================
// PANDU TASKS - GOOGLE APPS SCRIPT BACKEND
// Deployment Instructions:
// 1. Paste this into script.google.com
// 2. Fill in the FIREBASE_PROJECT_ID and your USER_UID (from the web app)
// 3. Select 'installPanduTriggers' from the top dropdown and click "Run"
// =====================================================================

const CONFIG = {
  FIREBASE_PROJECT_ID: "demo-project", // Auto-filled by web app
  USER_UID: "PASTE_YOUR_UID_HERE",                 
  APP_ID: "pandu-todo-default",
  MAX_EMAILS_SWEEP: 5,
  MAX_FILES_SWEEP: 5
};

// --- WEBHOOK FOR MANUAL & MORNING SWEEPS ---
// To use this: Click Deploy -> New Deployment -> Select "Web App"
// Execute as: Me. Who has access: Anyone. 
// Copy the URL and paste it into Pandu Settings.
function doGet(e) {
  sweepContext();
  return ContentService.createTextOutput(JSON.stringify({status: "success", message: "Manual sweep executed."}))
    .setMimeType(ContentService.MimeType.JSON);
}

function installPanduTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
  
  ScriptApp.newTrigger('sweepContext')
    .timeBased()
    .everyHours(1)
    .create();
    
  ScriptApp.newTrigger('sendSundaySummary')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(9)
    .create();
    
  console.log("Triggers installed! Pandu is connected.");
}

function sweepContext() {
  if (!CONFIG.USER_UID || CONFIG.USER_UID.includes("PASTE_YOUR")) {
    console.error("Please configure your USER_UID.");
    return;
  }

  let maxRetries = 3;
  let attempt = 0;
  let success = false;

  while (attempt < maxRetries && !success) {
    try {
      attempt++;
      const contextData = {
        lastSweepTime: new Date().toISOString(),
        emails: [],
        files: []
      };

      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      const formattedDate = Utilities.formatDate(oneDayAgo, Session.getScriptTimeZone(), "yyyy/MM/dd");
      
      const threads = GmailApp.search(`is:unread is:important after:${formattedDate}`, 0, CONFIG.MAX_EMAILS_SWEEP);
      threads.forEach(thread => {
        const messages = thread.getMessages();
        const latestMsg = messages[messages.length - 1];
        contextData.emails.push({
          subject: thread.getFirstMessageSubject(),
          sender: latestMsg.getFrom(),
          snippet: latestMsg.getPlainBody().substring(0, 200) + '...',
          link: thread.getPermalink(),
          date: latestMsg.getDate().toISOString()
        });
      });

      const files = DriveApp.searchFiles(`modifiedDate > '${formattedDate}'`);
      let fileCount = 0;
      while (files.hasNext() && fileCount < CONFIG.MAX_FILES_SWEEP) {
        const file = files.next();
        contextData.files.push({
          name: file.getName(),
          url: file.getUrl(),
          type: file.getMimeType(),
          lastUpdated: file.getLastUpdated().toISOString()
        });
        fileCount++;
      }

      pushToFirebase(contextData);
      console.log("Context swept and pushed on attempt " + attempt);
      success = true; 

    } catch (error) {
      console.error(`Sweep error (Attempt ${attempt}):`, error);
      if (attempt < maxRetries) Utilities.sleep(5000); 
    }
  }
}

function pushToFirebase(data) {
  const url = `https://firestore.googleapis.com/v1/projects/${CONFIG.FIREBASE_PROJECT_ID}/databases/(default)/documents/artifacts/${CONFIG.APP_ID}/users/${CONFIG.USER_UID}/context/latest`;
  
  const firestorePayload = {
    fields: {
      lastSweepTime: { stringValue: data.lastSweepTime },
      emails: { stringValue: JSON.stringify(data.emails) },
      files: { stringValue: JSON.stringify(data.files) }
    }
  };

  const options = {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify(firestorePayload),
    muteHttpExceptions: true
  };

  UrlFetchApp.fetch(url, options);
}

function sendSundaySummary() {
  const userEmail = Session.getActiveUser().getEmail();
  if (!userEmail) return;

  const htmlBody = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background-color: #050505; color: #fff; padding: 40px; border-radius: 20px;">
      <h2 style="color: #818cf8; margin-bottom: 5px;">Pandu Weekly Sweep</h2>
      <p style="color: #a3a3a3; font-size: 14px; margin-top: 0;">Here is your performance diagnostic.</p>
      
      <div style="background-color: #141414; border: 1px solid #262626; border-radius: 12px; padding: 20px; margin-top: 30px;">
        <h3 style="margin-top: 0;">System Nominal</h3>
        <p style="color: #a3a3a3;">You have maintained high focus. Tasks cleared, context secured. Prepare for Monday.</p>
      </div>
    </div>
  `;

  MailApp.sendEmail({
    to: userEmail,
    subject: "🐼 Your Pandu Weekly Diagnostic",
    htmlBody: htmlBody
  });
}
