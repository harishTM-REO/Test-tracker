// services/authService.js
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

class AuthService {
  // Generate JWT token
  generateToken(userId) {
    return jwt.sign(
      { userId },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
  }

  // Generate refresh token
  generateRefreshToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Register new user
  async register(userData) {
    try {
      const { email, firstName, lastName, password, role = 'user' } = userData;

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        throw new Error('User already exists with this email');
      }

      // Create new user
      const user = new User({
        email,
        firstName,
        lastName,
        password,
        role
      });

      // Generate email verification token
      const verificationToken = user.createEmailVerificationToken();
      
      await user.save();

      // Send verification email
      await this.sendVerificationEmail(user, verificationToken);

      // Generate JWT token
      const token = this.generateToken(user._id);

      return {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: user.fullName,
          role: user.role,
          permissions: user.permissions,
          isEmailVerified: user.isEmailVerified
        },
        token,
        message: 'User registered successfully. Please check your email for verification.'
      };

    } catch (error) {
      throw error;
    }
  }

  // Login user
  async login(email, password) {
    try {
      const user = await User.findByCredentials(email, password);

      // Generate JWT token
      const token = this.generateToken(user._id);

      return {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: user.fullName,
          role: user.role,
          permissions: user.permissions,
          isEmailVerified: user.isEmailVerified,
          lastLogin: user.lastLogin
        },
        token,
        message: 'Login successful'
      };

    } catch (error) {
      throw error;
    }
  }

  // Forgot password
  async forgotPassword(email) {
    try {
      const user = await User.findOne({ email, isActive: true });
      
      if (!user) {
        throw new Error('No user found with this email address');
      }

      // Generate password reset token
      const resetToken = user.createPasswordResetToken();
      await user.save({ validateBeforeSave: false });

      // Send password reset email
      await this.sendPasswordResetEmail(user, resetToken);

      return {
        message: 'Password reset token sent to email'
      };

    } catch (error) {
      throw error;
    }
  }

  // Reset password
  async resetPassword(token, newPassword) {
    try {
      // Hash the token to compare with stored hash
      const hashedToken = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');

      // Find user with valid reset token
      const user = await User.findOne({
        passwordResetToken: hashedToken,
        passwordResetExpires: { $gt: Date.now() },
        isActive: true
      });

      if (!user) {
        throw new Error('Token is invalid or has expired');
      }

      // Set new password
      user.password = newPassword;
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      
      await user.save();

      // Generate new JWT token
      const jwtToken = this.generateToken(user._id);

      return {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: user.fullName,
          role: user.role,
          permissions: user.permissions
        },
        token: jwtToken,
        message: 'Password reset successful'
      };

    } catch (error) {
      throw error;
    }
  }

  // Verify email
  async verifyEmail(token) {
    try {
      const hashedToken = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');

      const user = await User.findOne({
        emailVerificationToken: hashedToken,
        emailVerificationExpires: { $gt: Date.now() }
      });

      if (!user) {
        throw new Error('Token is invalid or has expired');
      }

      user.isEmailVerified = true;
      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;
      
      await user.save();

      return {
        message: 'Email verified successfully'
      };

    } catch (error) {
      throw error;
    }
  }

  // Change password (for logged-in users)
  async changePassword(userId, currentPassword, newPassword) {
    try {
      const user = await User.findById(userId).select('+password');
      
      if (!user) {
        throw new Error('User not found');
      }

      // Verify current password
      const isCurrentPasswordCorrect = await user.comparePassword(currentPassword);
      
      if (!isCurrentPasswordCorrect) {
        throw new Error('Current password is incorrect');
      }

      // Set new password
      user.password = newPassword;
      await user.save();

      return {
        message: 'Password changed successfully'
      };

    } catch (error) {
      throw error;
    }
  }

  // Update user profile
  async updateProfile(userId, updateData) {
    try {
      const allowedUpdates = [
        'firstName', 'lastName', 'phoneNumber', 'department', 
        'timezone', 'preferences', 'profileImage'
      ];
      
      const updates = {};
      Object.keys(updateData).forEach(key => {
        if (allowedUpdates.includes(key)) {
          updates[key] = updateData[key];
        }
      });

      const user = await User.findByIdAndUpdate(
        userId,
        updates,
        { new: true, runValidators: true }
      );

      if (!user) {
        throw new Error('User not found');
      }

      return {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: user.fullName,
          role: user.role,
          permissions: user.permissions,
          phoneNumber: user.phoneNumber,
          department: user.department,
          timezone: user.timezone,
          preferences: user.preferences,
          profileImage: user.profileImage
        },
        message: 'Profile updated successfully'
      };

    } catch (error) {
      throw error;
    }
  }

  // Get user by ID
  async getUserById(userId) {
    try {
      const user = await User.findById(userId);
      
      if (!user || !user.isActive) {
        throw new Error('User not found');
      }

      return {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        role: user.role,
        permissions: user.permissions,
        isEmailVerified: user.isEmailVerified,
        phoneNumber: user.phoneNumber,
        department: user.department,
        timezone: user.timezone,
        preferences: user.preferences,
        profileImage: user.profileImage,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt
      };

    } catch (error) {
      throw error;
    }
  }

  // Send verification email
  async sendVerificationEmail(user, token) {
    try {
      const transporter = nodemailer.createTransporter({
        // Configure your email service
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        auth: {
          user: process.env.EMAIL_USERNAME,
          pass: process.env.EMAIL_PASSWORD
        }
      });

      const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${token}`;

      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: user.email,
        subject: 'Email Verification - Experiment Tracker',
        html: `
          <h2>Email Verification</h2>
          <p>Hello ${user.firstName},</p>
          <p>Please click the link below to verify your email address:</p>
          <a href="${verificationUrl}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Verify Email</a>
          <p>This link will expire in 24 hours.</p>
          <p>If you didn't create an account, please ignore this email.</p>
        `
      };

      await transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending verification email:', error);
    }
  }

  // Send password reset email
  async sendPasswordResetEmail(user, token) {
    try {
      const transporter = nodemailer.createTransporter({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        auth: {
          user: process.env.EMAIL_USERNAME,
          pass: process.env.EMAIL_PASSWORD
        }
      });

      const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${token}`;

      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: user.email,
        subject: 'Password Reset - Experiment Tracker',
        html: `
          <h2>Password Reset</h2>
          <p>Hello ${user.firstName},</p>
          <p>You requested a password reset. Click the link below to reset your password:</p>
          <a href="${resetUrl}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a>
          <p>This link will expire in 10 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
        `
      };

      await transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending password reset email:', error);
    }
  }
}

module.exports = new AuthService();