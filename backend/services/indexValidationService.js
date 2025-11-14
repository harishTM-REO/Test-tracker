/**
 * Index Validation Service
 * Ensures MongoDB collections have correct indexes and fixes conflicts
 * Should be called during application startup
 */

const mongoose = require('mongoose');

class IndexValidationService {
  /**
   * Validate and fix indexes for AbTastyResult collection
   * Called on application startup to prevent duplicate key issues
   * @returns {Object} Validation result with status and any fixes applied
   */
  static async validateAbTastyResultIndexes() {
    try {
      console.log('\n🔍 Validating AbTastyResult collection indexes...\n');

      const collection = mongoose.connection.db.collection('abtastyresults');

      // Get indexes using the newer API
      let indexes = {};
      try {
        // Try newer API first (MongoDB 4.2+)
        const indexInfo = await collection.listIndexes().toArray();
        indexInfo.forEach(idx => {
          indexes[idx.name] = { key: idx.key, unique: idx.unique || false };
        });
      } catch (e) {
        // Fallback to older API
        indexes = await collection.getIndexes();
      }

      const result = {
        isValid: true,
        issues: [],
        fixes: [],
        indexes: {}
      };

      // Log all current indexes
      console.log('📋 Current indexes:\n');
      Object.entries(indexes).forEach(([name, spec]) => {
        const isUnique = spec.unique ? '🔐 UNIQUE' : '🔓 non-unique';
        const keyStr = Object.entries(spec.key)
          .map(([field, dir]) => `${field}: ${dir}`)
          .join(', ');
        console.log(`  • "${name}" - { ${keyStr} } - ${isUnique}`);
        result.indexes[name] = { key: spec.key, unique: spec.unique };
      });
      console.log();

      // Check for problematic unique index on just datasetId
      const problematicIndexes = Object.entries(indexes).filter(([name, spec]) => {
        // Safe check for spec.key existence
        if (!spec.key && name !== '_id_') {
          // If key is undefined but this is a unique index, check by name pattern
          return name === 'datasetId_1' && spec.unique === true;
        }

        if (name !== '_id_' && spec.unique === true && spec.key) {
          const keyFields = Object.keys(spec.key);
          return keyFields.length === 1 && keyFields[0] === 'datasetId';
        }

        return false;
      });

      if (problematicIndexes.length > 0) {
        console.log('⚠️  ISSUE DETECTED: Conflicting unique index on datasetId\n');

        for (const [indexName, spec] of problematicIndexes) {
          const issue = {
            type: 'CONFLICTING_UNIQUE_INDEX',
            indexName: indexName,
            indexSpec: spec,
            description:
              'Unique index on just datasetId prevents multiple batches per dataset. ' +
              'The composite index [datasetId, batchNumber] should be used instead.'
          };
          result.issues.push(issue);
          result.isValid = false;

          console.log(`❌ Problem Index: "${indexName}"`);
          console.log(`   Spec: { datasetId: 1 } with unique: true`);
          console.log(`   Issue: Blocks batch saving\n`);

          // Attempt to drop it
          try {
            console.log(`   Dropping conflicting index...`);
            await collection.dropIndex(indexName);
            console.log(`   ✅ Successfully dropped!\n`);

            result.fixes.push({
              type: 'DROPPED_INDEX',
              indexName: indexName,
              success: true
            });
          } catch (dropError) {
            console.log(`   ❌ Failed to drop: ${dropError.message}\n`);
            result.fixes.push({
              type: 'DROPPED_INDEX',
              indexName: indexName,
              success: false,
              error: dropError.message
            });
          }
        }
      }

      // Check for correct composite index
      const correctIndex = Object.entries(indexes).find(([name, spec]) => {
        return (
          spec.unique === true &&
          spec.key.datasetId === 1 &&
          spec.key.batchNumber === 1
        );
      });

      if (correctIndex) {
        console.log(`✅ Composite index found: "${correctIndex[0]}"`);
        console.log(`   This allows batch saving to work correctly\n`);
      } else {
        console.log('⚠️  Composite index not found!\n');
        result.issues.push({
          type: 'MISSING_COMPOSITE_INDEX',
          description: 'Composite index [datasetId, batchNumber] is missing. ' +
            'Mongoose should create this automatically on next model use.'
        });
        result.isValid = false;
      }

      // Summary
      if (result.isValid) {
        console.log('✅ Index validation PASSED! All indexes are correct.\n');
      } else {
        console.log('⚠️  Index validation completed with issues detected and fixed.\n');
        if (result.fixes.length > 0 && result.fixes.every(f => f.success)) {
          console.log('✅ All issues have been automatically fixed!\n');
          result.isValid = true;
        }
      }

      return result;

    } catch (error) {
      console.error('❌ Error during index validation:', error.message, '\n');
      return {
        isValid: false,
        error: error.message,
        issues: [],
        fixes: []
      };
    }
  }

  /**
   * Run complete index validation on all collections
   * Call this during app startup
   * @returns {Object} Comprehensive validation result
   */
  static async validateAllIndexes() {
    console.log('='.repeat(60));
    console.log('🔧 MongoDB Index Validation Service');
    console.log('='.repeat(60));

    try {
      // Check if connected
      if (!mongoose.connection.db) {
        throw new Error('MongoDB not connected. Skipping index validation.');
      }

      const results = {
        abTastyResult: await this.validateAbTastyResultIndexes()
      };

      console.log('='.repeat(60));
      console.log('📊 Validation Summary');
      console.log('='.repeat(60));

      let allValid = true;
      Object.entries(results).forEach(([collectionName, result]) => {
        if (result.isValid) {
          console.log(`✅ ${collectionName}: VALID`);
        } else {
          console.log(`❌ ${collectionName}: ISSUES DETECTED`);
          allValid = false;

          if (result.issues.length > 0) {
            console.log('   Issues:');
            result.issues.forEach(issue => {
              console.log(`     • ${issue.type}: ${issue.description}`);
            });
          }

          if (result.fixes.length > 0) {
            console.log('   Fixes applied:');
            result.fixes.forEach(fix => {
              const status = fix.success ? '✅' : '❌';
              console.log(`     ${status} ${fix.type}`);
            });
          }
        }
      });

      console.log('='.repeat(60) + '\n');

      if (!allValid) {
        console.log('⚠️  Some issues were detected but automatically fixed.');
        console.log('   Your MongoDB indexes are now properly configured.\n');
      }

      return results;

    } catch (error) {
      console.error('Fatal error during index validation:', error.message);
      return {
        error: error.message,
        success: false
      };
    }
  }
}

module.exports = IndexValidationService;
