const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Store reset tokens with expiration (in memory for demo, use database in production)
const resetTokens = new Map();

// Generate a secure random token
function generateResetToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Create a transporter using Gmail SMTP
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,     // Your Gmail address
        pass: process.env.EMAIL_APP_PASS  // Your 16-character App Password
    }
});

// Send password reset email
async function sendPasswordResetEmail(userEmail, token) {
    const resetLink = `http://localhost:3000/reset-password.html?token=${token}`;
    
    const mailOptions = {
        from: process.env.EMAIL_USER,  // Your Gmail address
        to: userEmail,                 // User's email (recipient)
        subject: 'Password Reset Request',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333; text-align: center;">Password Reset Request</h2>
                <p>You requested to reset your password. Click the button below to reset it:</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${resetLink}" 
                       style="background-color: #007bff; 
                              color: white; 
                              padding: 12px 24px; 
                              text-decoration: none; 
                              border-radius: 4px;">
                        Reset Password
                    </a>
                </div>
                <p><strong>Important:</strong> This link will expire in 1 hour.</p>
                <p>If you did not request this password reset, please ignore this email.</p>
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
                <p style="color: #666; font-size: 12px; text-align: center;">
                    This is an automated message, please do not reply to this email.
                </p>
            </div>
        `
    };

    try {
        // Log that we're attempting to send email
        console.log('Attempting to send reset email to:', userEmail);
        
        // Send the email
        const info = await transporter.sendMail(mailOptions);
        console.log('Reset email sent successfully:', info.messageId);
        
        // Also log the reset link for development purposes
        console.log('Password reset link:', resetLink);
        
        return true;
    } catch (error) {
        console.error('Error sending reset email:', error);
        throw error;
    }
}

// Store a reset token with expiration
function storeResetToken(email, token) {
    const expiration = Date.now() + 3600000; // 1 hour in milliseconds
    resetTokens.set(token, { email, expiration });
    console.log(`Reset token stored for ${email}`);
}

// Validate a reset token
function validateResetToken(token) {
    const tokenData = resetTokens.get(token);
    if (!tokenData) {
        return null;
    }

    if (Date.now() > tokenData.expiration) {
        resetTokens.delete(token);
        return null;
    }

    return tokenData.email;
}

// Delete a used token
function deleteResetToken(token) {
    resetTokens.delete(token);
}

module.exports = {
    sendPasswordResetEmail,
    generateResetToken,
    storeResetToken,
    validateResetToken,
    deleteResetToken
};
