const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// Configuration file for notification settings
const CONFIG_FILE = path.join(__dirname, '../data/notification-config.json');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize config if it doesn't exist
if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    smsEnabled: false,
    emailEnabled: true,
    notificationPhone: '',
    notificationEmail: 'ghiona@gmail.com',
    emailPassword: 'your-gmail-app-password', // You'll need to update this
    logNotifications: true,
    sentMessages: []
  }, null, 2));
}

// Load configuration
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (error) {
    console.error('Error loading notification config:', error);
    return {
      smsEnabled: false,
      emailEnabled: true,
      notificationPhone: '',
      notificationEmail: 'ghiona@gmail.com',
      emailPassword: 'your-gmail-app-password',
      logNotifications: true,
      sentMessages: []
    };
  }
}

// Save configuration
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving notification config:', error);
    return false;
  }
}

// Log notification
function logNotification(recipient, subject, message) {
  console.log(`[NOTIFICATION TO ${recipient}] ${subject}: ${message}`);
  return {
    success: true,
    method: 'log',
    message: 'Notification logged (not sent)',
    timestamp: new Date().toISOString()
  };
}

// Send email notification
async function sendEmailNotification(email, subject, message) {
  try {
    const config = loadConfig();
    
    // Skip sending if no credentials
    if (!config.notificationEmail || !config.emailPassword) {
      console.log(`[EMAIL NOT SENT - NO CREDENTIALS] To: ${email}, Subject: ${subject}`);
      return {
        success: false,
        method: 'email',
        message: 'Email not sent - no credentials configured',
        timestamp: new Date().toISOString()
      };
    }
    
    // Create a Gmail transporter
    let transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: config.notificationEmail,
        pass: config.emailPassword // This should be an app password, not your regular Gmail password
      }
    });
    
    // Send mail
    let info = await transporter.sendMail({
      from: `"Flight Tracker" <${config.notificationEmail}>`,
      to: email,
      subject: subject,
      text: message,
      html: `<p>${message.replace(/\n/g, '<br>')}</p>`
    });
    
    console.log(`Email sent to ${email}: ${info.messageId}`);
    
    // Record in message history
    recordMessage(email, subject, message, 'email');
    
    return {
      success: true,
      method: 'email',
      message: `Email sent: ${info.messageId}`,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error sending email:', error);
    
    // Record the failed attempt in history
    recordMessage(email, subject, `FAILED: ${message} (Error: ${error.message})`, 'email-failed');
    
    return {
      success: false,
      method: 'email',
      message: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Send notification (SMS or email)
async function sendNotification(recipient, subject, message) {
  const config = loadConfig();
  
  // Always log if enabled, regardless of other settings
  if (config.logNotifications) {
    logNotification(recipient || 'LOG', subject, message);
  }
  
  // If email is enabled and we have an email address
  if (config.emailEnabled && config.notificationEmail) {
    const email = recipient || config.notificationEmail;
    return await sendEmailNotification(email, subject, message);
  }
  
  // If neither email nor log is working, return failure
  return {
    success: false,
    method: 'none',
    message: 'No notification method available',
    timestamp: new Date().toISOString()
  };
}

// Record message in history
function recordMessage(recipient, subject, message, method) {
  try {
    const config = loadConfig();
    const sentMessages = config.sentMessages || [];
    
    sentMessages.push({
      recipient,
      subject,
      message,
      method,
      timestamp: new Date().toISOString()
    });
    
    // Keep only the last 100 messages
    if (sentMessages.length > 100) {
      sentMessages.shift();
    }
    
    config.sentMessages = sentMessages;
    saveConfig(config);
  } catch (error) {
    console.error('Error recording message:', error);
  }
}

// Update configuration
function updateConfig(newConfig) {
  const config = loadConfig();
  const updatedConfig = { ...config, ...newConfig };
  return saveConfig(updatedConfig);
}

// Get configuration
function getConfig() {
  return loadConfig();
}

// Get message history
function getMessageHistory() {
  const config = loadConfig();
  return config.sentMessages || [];
}

module.exports = {
  sendNotification,
  updateConfig,
  getConfig,
  getMessageHistory
};
