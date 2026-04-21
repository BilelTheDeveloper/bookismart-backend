import nodemailer from 'nodemailer';

/**
 * 📧 BOOKIIFY EMAIL ENGINE - 2026 EDITION
 * Purpose: Handles high-fidelity transactional notifications for KYC & Auth.
 */

// Initialize Transporter with Connection Pooling for performance
const transporter = nodemailer.createTransport({
  service: 'gmail',
  pool: true, // Keeps the connection open for multiple emails
  maxConnections: 5,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // App Password required
  },
});

/**
 * Core Logic: Generates and sends a branded status email.
 */
export const sendStatusEmail = async (userEmail, userName, status, reason = "") => {
  const isApproved = status === 'active';
  const brandColor = isApproved ? '#4f46e5' : '#e11d48';
  const accentColor = isApproved ? '#f5f3ff' : '#fff1f2';
  const borderColor = isApproved ? '#ddd6fe' : '#fda4af';

  const mailOptions = {
    from: `"Bookiify Control Center" <${process.env.EMAIL_USER}>`,
    to: userEmail,
    subject: isApproved 
      ? "✔️ Account Verified: Your Professional Dashboard is Ready" 
      : "⚠️ Action Required: Bookiify Application Update",
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          .container { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; border: 1px solid #f1f5f9; padding: 40px; border-radius: 24px; color: #1e293b; line-height: 1.6; }
          .logo-text { font-size: 24px; font-weight: 900; letter-spacing: -1px; color: #0f172a; margin-bottom: 30px; }
          .status-badge { display: inline-block; padding: 6px 14px; border-radius: 99px; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 20px; 
            background-color: ${accentColor}; color: ${brandColor}; border: 1px solid ${borderColor}; }
          .headline { font-size: 32px; font-weight: 900; line-height: 1.1; margin-bottom: 20px; color: #0f172a; }
          .message { font-size: 16px; color: #64748b; margin-bottom: 30px; }
          .reason-box { background: #f8fafc; border-left: 4px solid #e11d48; padding: 20px; border-radius: 12px; margin-bottom: 30px; text-align: left; }
          .btn { display: inline-block; background: ${brandColor}; color: white !important; padding: 18px 35px; border-radius: 16px; text-decoration: none; font-weight: 800; font-size: 14px; box-shadow: 0 10px 20px -5px ${brandColor}40; }
          .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="logo-text">BOOKIIFY<span style="color: #4f46e5;">.</span></div>
          
          <div class="status-badge">${isApproved ? 'Verified' : 'Review Required'}</div>
          
          <h1 class="headline">
            ${isApproved ? 'Identity Verified.<br/>Welcome to the Elite.' : 'Application Needs<br/>Your Attention.'}
          </h1>

          <p class="message">
            Hello <strong>${userName}</strong>,<br/>
            ${isApproved 
              ? "Your professional credentials have been successfully validated. Your business portal is now fully unlocked and ready for bookings." 
              : "Our compliance team has completed the initial review of your application. Unfortunately, we cannot move forward with your current submission."}
          </p>

          ${!isApproved ? `
            <div class="reason-box">
              <p style="margin: 0; font-weight: 800; font-size: 12px; color: #e11d48; text-transform: uppercase; margin-bottom: 5px;">Rejection Reason</p>
              <p style="margin: 0; color: #1e293b; font-weight: 500;">${reason}</p>
            </div>
            <p class="message" style="font-size: 14px;">Please log in to your account to update your documents or provide the missing information specified above.</p>
          ` : ""}

          <div style="text-align: center; margin-top: 40px;">
            <a href="${process.env.CLIENT_URL}/login" class="btn">
              ${isApproved ? 'ENTER DASHBOARD' : 'RE-UPLOAD DOCUMENTS'}
            </a>
          </div>

          <div class="footer">
            <p>This is an automated security notification from Bookiify Systems.<br/>
            &copy; 2026 Bookiify Technology Group. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 Email Dispatched: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("❌ Email Delivery Failed:", error);
    // We don't throw an error here to prevent the whole verification process 
    // from crashing if the email service is temporarily down.
    return { success: false, error: error.message };
  }
};