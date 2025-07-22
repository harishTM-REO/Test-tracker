// services/userService.js
const User = require('../models/User');

class UserService {
  // Get all users (admin only)
  async getAllUsers(page = 1, limit = 20, filters = {}) {
    try {
      const skip = (page - 1) * limit;
      
      // Build query
      let query = { isActive: true };
      
      if (filters.role) {
        query.role = filters.role;
      }
      
      if (filters.search) {
        query.$or = [
          { firstName: { $regex: filters.search, $options: 'i' } },
          { lastName: { $regex: filters.search, $options: 'i' } },
          { email: { $regex: filters.search, $options: 'i' } }
        ];
      }

      const users = await User.find(query)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await User.countDocuments(query);

      return {
        users,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };

    } catch (error) {
      throw error;
    }
  }

  // Update user role (superadmin only)
  async updateUserRole(userId, newRole, adminUserId) {
    try {
      // Check if admin has permission
      const admin = await User.findById(adminUserId);
      if (!admin || !admin.permissions.canManageUsers) {
        throw new Error('Insufficient permissions');
      }

      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Prevent changing own role
      if (userId === adminUserId) {
        throw new Error('Cannot change your own role');
      }

      user.role = newRole;
      await user.save();

      return {
        message: 'User role updated successfully',
        user: {
          id: user._id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          permissions: user.permissions
        }
      };

    } catch (error) {
      throw error;
    }
  }

  // Deactivate user
  async deactivateUser(userId, adminUserId) {
    try {
      const admin = await User.findById(adminUserId);
      if (!admin || !admin.permissions.canManageUsers) {
        throw new Error('Insufficient permissions');
      }

      if (userId === adminUserId) {
        throw new Error('Cannot deactivate your own account');
      }

      const user = await User.findByIdAndUpdate(
        userId,
        { isActive: false },
        { new: true }
      );

      if (!user) {
        throw new Error('User not found');
      }

      return {
        message: 'User deactivated successfully'
      };

    } catch (error) {
      throw error;
    }
  }

  // Activate user
  async activateUser(userId, adminUserId) {
    try {
      const admin = await User.findById(adminUserId);
      if (!admin || !admin.permissions.canManageUsers) {
        throw new Error('Insufficient permissions');
      }

      const user = await User.findByIdAndUpdate(
        userId,
        { isActive: true },
        { new: true }
      );

      if (!user) {
        throw new Error('User not found');
      }

      return {
        message: 'User activated successfully'
      };

    } catch (error) {
      throw error;
    }
  }

  // Get user statistics
  async getUserStats() {
    try {
      const stats = await User.aggregate([
        {
          $group: {
            _id: '$role',
            count: { $sum: 1 }
          }
        }
      ]);

      const totalUsers = await User.countDocuments({ isActive: true });
      const totalInactive = await User.countDocuments({ isActive: false });
      const recentUsers = await User.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      });

      return {
        totalUsers,
        totalInactive,
        recentUsers,
        roleDistribution: stats
      };

    } catch (error) {
      throw error;
    }
  }
}

module.exports = new UserService();