<template>
  <div>
    <h4 class="heading">File Data Dashboard</h4>
    
    <!-- File Upload Section -->
    <v-card class="upload-card" elevation="2">
      <v-card-title class="card-title">
        <v-icon color="primary" class="title-icon">mdi-file-upload</v-icon>
        <span>Upload Data File</span>
      </v-card-title>
      <v-card-text>
        <div class="upload-zone" 
             :class="{ 'drag-over': dragOver }"
             @dragover.prevent="dragOver = true"
             @dragleave.prevent="dragOver = false"
             @drop.prevent="handleFileDrop">
          <input
            ref="fileInput"
            type="file"
            accept=".xlsx,.xls,.csv"
            @change="handleFileSelect"
            style="display: none"
          />
          
          <div v-if="!selectedFile" class="upload-content">
            <v-icon size="64" color="primary" class="upload-icon">mdi-cloud-upload</v-icon>
            <h3 class="upload-title">Drop your file here or click to browse</h3>
            <p class="upload-subtitle">Supports XLSX, XLS, and CSV files</p>
            <v-btn
              color="primary"
              variant="outlined"
              size="large"
              @click="$refs.fileInput.click()"
            >
              <v-icon start>mdi-file-plus</v-icon>
              Choose File
            </v-btn>
          </div>

          <div v-else class="file-selected">
            <v-icon size="48" :color="getFileTypeColor(selectedFile.type)" class="file-icon">
              {{ getFileIcon(selectedFile.type) }}
            </v-icon>
            <div class="file-info">
              <h4 class="file-name">{{ selectedFile.name }}</h4>
              <p class="file-details">{{ formatFileSize(selectedFile.size) }} • {{ getFileType(selectedFile.type) }}</p>
            </div>
            <div class="file-actions">
              <v-btn
                color="success"
                variant="elevated"
                @click="processFile"
                :loading="processing"
              >
                <v-icon start>mdi-play</v-icon>
                Process File
              </v-btn>
              <v-btn
                color="error"
                variant="outlined"
                @click="clearFile"
                :disabled="processing"
              >
                <v-icon start>mdi-delete</v-icon>
                Remove
              </v-btn>
            </div>
          </div>
        </div>
      </v-card-text>
    </v-card>

    <!-- Processing State -->
    <div v-if="processing" class="loading-container">
      <v-progress-circular
        indeterminate
        color="primary"
        size="64"
      ></v-progress-circular>
      <p class="loading-text">Processing file...</p>
    </div>

    <!-- Error State -->
    <div v-if="error" class="error-container">
      <v-alert
        type="error"
        variant="tonal"
        prominent
        border="start"
      >
        <v-alert-title>Error Processing File</v-alert-title>
        {{ error }}
      </v-alert>
      <v-btn
        @click="error = null"
        color="primary"
        variant="outlined"
        class="retry-btn"
      >
        <v-icon start>mdi-close</v-icon>
        Dismiss
      </v-btn>
    </div>

    <!-- Data Display -->
    <div v-if="data && !processing">
      <!-- File Info Card -->
      <v-card class="header-card" elevation="2">
        <v-card-title class="card-title">
          <v-icon color="success" class="title-icon">mdi-file-check</v-icon>
          <span>File Information</span>
        </v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="12" md="6">
              <div class="info-item">
                <v-icon color="blue" class="info-icon">mdi-file-document</v-icon>
                <strong>File Name:</strong>
              </div>
              <v-chip
                color="blue"
                variant="outlined"
                size="small"
                class="file-chip"
              >
                {{ data.fileName }}
              </v-chip>
            </v-col>
            <v-col cols="12" md="6">
              <div class="info-detail">
                <strong>File Type:</strong> {{ data.fileType }}
              </div>
              <div class="info-detail">
                <strong>File Size:</strong> {{ data.fileSize }}
              </div>
              <div class="info-detail">
                <strong>Processed:</strong> {{ formatDate(data.processedAt) }}
              </div>
              <div v-if="data.workbookInfo" class="info-detail">
                <strong>Excel Version:</strong> {{ data.workbookInfo.fileVersion }}
              </div>
              <div v-if="data.workbookInfo && data.workbookInfo.hasFormulas" class="info-detail">
                <v-chip size="small" color="warning" variant="outlined">
                  <v-icon start size="small">mdi-function</v-icon>
                  Contains Formulas
                </v-chip>
              </div>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>

      <!-- Statistics Cards -->
      <v-row class="stats-row">
        <v-col cols="12" sm="3">
          <v-card color="primary" variant="tonal">
            <v-card-text class="stat-card">
              <v-icon size="48" color="primary" class="stat-icon">mdi-table</v-icon>
              <div class="stat-number">{{ data.sheets?.length || 1 }}</div>
              <div class="stat-label">Sheets/Tables</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="3">
          <v-card color="success" variant="tonal">
            <v-card-text class="stat-card">
              <v-icon size="48" color="success" class="stat-icon">mdi-table-row</v-icon>
              <div class="stat-number">{{ data.totalRows }}</div>
              <div class="stat-label">Total Rows</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="3">
          <v-card color="info" variant="tonal">
            <v-card-text class="stat-card">
              <v-icon size="48" color="info" class="stat-icon">mdi-table-column</v-icon>
              <div class="stat-number">{{ data.totalColumns }}</div>
              <div class="stat-label">Total Columns</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="3">
          <v-card color="warning" variant="tonal">
            <v-card-text class="stat-card">
              <v-icon size="48" color="warning" class="stat-icon">mdi-database</v-icon>
              <div class="stat-number">{{ data.totalCells }}</div>
              <div class="stat-label">Total Cells</div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <!-- Data Preview -->
      <v-card elevation="2" class="data-card">
        <v-card-title class="data-header">
          <div class="data-title">
            <v-icon color="primary" class="title-icon">mdi-table-search</v-icon>
            <span>Data Preview</span>
          </div>
          <div class="data-controls">
            <v-select
              v-if="data.sheets && data.sheets.length > 1"
              v-model="selectedSheet"
              :items="data.sheets"
              item-title="name"
              item-value="name"
              label="Select Sheet"
              density="compact"
              variant="outlined"
              style="min-width: 200px; margin-right: 16px;"
            ></v-select>
            <v-chip color="primary" variant="outlined">
              {{ getCurrentSheetData().rows.length }} rows
            </v-chip>
          </div>
        </v-card-title>
        
        <v-card-text>
          <div class="table-container">
            <v-table density="compact" class="data-table">
              <thead>
                <tr>
                  <th class="row-number">#</th>
                  <th 
                    v-for="(column, index) in getCurrentSheetData().columns" 
                    :key="index"
                    class="data-header-cell"
                  >
                    <div class="column-info">
                      <span class="column-name">{{ column }}</span>
                      <!-- <v-chip size="x-small" color="grey" variant="outlined">
                        {{ getColumnType(column) }}
                      </v-chip> -->
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr 
                  v-for="(row, rowIndex) in getCurrentSheetData().rows.slice(0, displayLimit)" 
                  :key="rowIndex"
                  class="data-row"
                >
                  <td class="row-number">{{ rowIndex + 1 }}</td>
                  <td 
                    v-for="(cell, cellIndex) in row" 
                    :key="cellIndex"
                    class="data-cell"
                  >
                    <span class="cell-content">{{ formatCellValue(cell) }}</span>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </div>

          <div v-if="getCurrentSheetData().rows.length > displayLimit" class="show-more-container">
            <v-btn
              @click="displayLimit += 20"
              color="primary"
              variant="outlined"
              block
            >
              Show More Rows ({{ getCurrentSheetData().rows.length - displayLimit }} remaining)
              <v-icon end>mdi-chevron-down</v-icon>
            </v-btn>
          </div>
        </v-card-text>
      </v-card>

      <!-- Save to Database -->
      <v-card class="save-card" elevation="2">
        <v-card-title class="card-title">
          <v-icon color="primary" class="title-icon">mdi-database</v-icon>
          <span>Save to Database</span>
        </v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="saveOptions.name"
                label="Dataset Name"
                variant="outlined"
                density="compact"
                placeholder="e.g., Optimizely Target List"
                :rules="[v => !!v || 'Name is required']"
              ></v-text-field>
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="saveOptions.version"
                label="Version"
                variant="outlined"
                density="compact"
                placeholder="e.g., v1.0, 2024-Q1"
              ></v-text-field>
            </v-col>
          </v-row>
          <v-row>
            <v-col cols="12">
              <v-textarea
                v-model="saveOptions.description"
                label="Description (Optional)"
                variant="outlined"
                density="compact"
                rows="2"
                placeholder="Brief description of this dataset or changes made..."
              ></v-textarea>
            </v-col>
          </v-row>
          <v-row>
            <v-col cols="12" sm="6">
              <v-btn
                @click="saveToDatabase"
                color="primary"
                variant="elevated"
                block
                :loading="saving"
                :disabled="!saveOptions.name || !data"
              >
                <v-icon start>mdi-database-plus</v-icon>
                Save to Database
              </v-btn>
            </v-col>
            <v-col cols="12" sm="6">
              <v-btn
                @click="loadDatasets"
                color="info"
                variant="outlined"
                block
                :loading="loadingDatasets"
              >
                <v-icon start>mdi-database-search</v-icon>
                View Saved Datasets
              </v-btn>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>

      <v-card v-if="datasets.length > 0" class="datasets-card" elevation="2">
        <v-card-title class="card-title">
          <v-icon color="success" class="title-icon">mdi-database-check</v-icon>
          <span>Saved Datasets</span>
          <v-spacer></v-spacer>
          <v-chip color="success" variant="outlined">
            {{ datasets.length }} dataset(s)
          </v-chip>
        </v-card-title>
        <v-card-text>
          <v-row>
            <v-col
              v-for="dataset in datasets"
              :key="dataset._id"
              cols="12"
              md="6"
              lg="4"
            >
              <v-card variant="outlined" hover class="dataset-card">
                <v-card-title class="dataset-title">
                  <div class="dataset-header">
                    <span class="dataset-name">{{ dataset.name }}</span>
                    <v-chip
                      color="primary"
                      size="small"
                      variant="flat"
                    >
                      {{ dataset.version }}
                    </v-chip>
                  </div>
                </v-card-title>
                
                <v-card-text>
                  <div class="dataset-info">
                    <v-icon size="small" class="info-icon">mdi-file-document</v-icon>
                    <span class="info-text">{{ dataset.originalFileName }}</span>
                  </div>
                  
                  <div class="dataset-info">
                    <v-icon size="small" class="info-icon">mdi-table-row</v-icon>
                    <span class="info-text">{{ dataset.totalRows  }} Domains Provided</span>
                  </div>
                  
                  <div class="dataset-info">
                    <v-icon size="small" class="info-icon">mdi-calendar</v-icon>
                    <span class="info-text">{{ formatDate(dataset.createdAt) }}</span>
                  </div>

                  <div v-if="dataset.description" class="dataset-description">
                    {{ dataset.description }}
                  </div>
                </v-card-text>

                <v-card-actions>
                  <v-btn
                    size="small"
                    variant="text"
                    color="primary"
                    @click="loadDataset(dataset)"
                  >
                    Load Data
                    <v-icon end>mdi-download</v-icon>
                  </v-btn>
                  
                  <v-menu>
                    <template v-slot:activator="{ props }">
                      <v-btn
                        size="small"
                        variant="text"
                        color="info"
                        v-bind="props"
                      >
                        Actions
                        <v-icon end>mdi-chevron-down</v-icon>
                      </v-btn>
                    </template>
                    <v-list>
                      <v-list-item @click="downloadDataset(dataset)">
                        <v-list-item-title>
                          <v-icon start>mdi-download</v-icon>
                          Download File
                        </v-list-item-title>
                      </v-list-item>
                      <!-- <v-list-item @click="duplicateDataset(dataset)">
                        <v-list-item-title>
                          <v-icon start>mdi-content-copy</v-icon>
                          Duplicate
                        </v-list-item-title>
                      </v-list-item> -->
                      <!-- <v-list-item @click="viewVersions(dataset)">
                        <v-list-item-title>
                          <v-icon start>mdi-history</v-icon>
                          View Versions
                        </v-list-item-title>
                      </v-list-item> -->
                      <v-divider></v-divider>
                      <v-list-item @click="deleteDataset(dataset._id)" class="text-error">
                        <v-list-item-title>
                          <v-icon start>mdi-delete</v-icon>
                          Delete
                        </v-list-item-title>
                      </v-list-item>
                    </v-list>
                  </v-menu>
                </v-card-actions>
              </v-card>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>

      <!-- Export Options -->
      <!-- <v-card class="export-card" variant="tonal" color="grey-lighten-4">
        <v-card-title class="card-title">
          <v-icon color="primary" class="title-icon">mdi-download</v-icon>
          <span>Export Options</span>
        </v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="12" sm="4">
              <v-btn
                @click="exportData('json')"
                color="info"
                variant="outlined"
                block
              >
                <v-icon start>mdi-code-json</v-icon>
                Export as JSON
              </v-btn>
            </v-col>
            <v-col cols="12" sm="4">
              <v-btn
                @click="exportData('csv')"
                color="success"
                variant="outlined"
                block
              >
                <v-icon start>mdi-file-delimited</v-icon>
                Export as CSV
              </v-btn>
            </v-col>
            <v-col cols="12" sm="4">
              <v-btn
                @click="showRawData = !showRawData"
                color="warning"
                variant="outlined"
                block
              >
                <v-icon start>mdi-eye</v-icon>
                {{ showRawData ? 'Hide' : 'Show' }} Raw Data
              </v-btn>
            </v-col>
          </v-row>

          <v-expand-transition>
            <div v-if="showRawData" class="raw-data-container">
              <v-textarea
                :model-value="JSON.stringify(getCurrentSheetData(), null, 2)"
                readonly
                auto-grow
                variant="outlined"
                label="Raw JSON Data"
                class="raw-data-textarea"
              ></v-textarea>
            </div>
          </v-expand-transition>
        </v-card-text>
      </v-card> -->
    </div>

    <!-- Notification Snackbar -->
    <v-snackbar
      v-model="showNotification"
      :color="notificationColor"
      :timeout="4000"
      top
      right
    >
      {{ notificationMessage }}
      <template v-slot:actions>
        <v-btn
          color="white"
          variant="text"
          @click="showNotification = false"
        >
          Close
        </v-btn>
      </template>
    </v-snackbar>

    <!-- Version History Dialog -->
    <v-dialog v-model="versionDialog" max-width="800px">
      <v-card>
        <v-card-title class="card-title">
          <v-icon color="primary" class="title-icon">mdi-history</v-icon>
          <span>Version History - {{ selectedDatasetForVersions?.name }}</span>
          <v-spacer></v-spacer>
          <v-btn icon @click="versionDialog = false">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        
        <v-card-text>
          <div v-if="loadingVersions" class="text-center pa-4">
            <v-progress-circular indeterminate color="primary"></v-progress-circular>
            <p class="mt-2">Loading versions...</p>
          </div>
          
          <div v-else-if="datasetVersions.length === 0" class="text-center pa-4">
            <v-icon size="64" color="grey">mdi-history</v-icon>
            <p class="text-grey mt-2">No version history available</p>
          </div>
          
          <v-timeline v-else side="end" align="start">
            <!-- Current Version -->
            <v-timeline-item
              dot-color="success"
              size="small"
              icon="mdi-star"
            >
              <div class="d-flex align-center">
                <strong>{{ selectedDatasetForVersions?.version }} (Current)</strong>
                <v-spacer></v-spacer>
                <v-chip size="small" color="success" variant="outlined">Current</v-chip>
              </div>
              <div class="text-caption text-grey mt-1">
                {{ formatDate(selectedDatasetForVersions?.createdAt) }}
              </div>
              <div class="mt-2">
                <v-btn
                  size="small"
                  variant="outlined"
                  color="primary"
                  @click="downloadDataset(selectedDatasetForVersions)"
                >
                  <v-icon start>mdi-download</v-icon>
                  Download
                </v-btn>
              </div>
            </v-timeline-item>

            <!-- Previous Versions -->
            <v-timeline-item
              v-for="(version, index) in datasetVersions"
              :key="index"
              dot-color="primary"
              size="small"
              icon="mdi-history"
            >
              <div class="d-flex align-center">
                <strong>{{ version.versionNumber }}</strong>
                <v-spacer></v-spacer>
                <v-chip size="small" color="grey" variant="outlined">
                  {{ formatFileSize(version.fileSize) }}
                </v-chip>
              </div>
              <div class="text-caption text-grey mt-1">
                {{ formatDate(version.uploadedAt) }}
              </div>
              <div v-if="version.changes" class="mt-1 text-body-2">
                {{ version.changes }}
              </div>
              <div class="mt-2">
                <v-btn
                  size="small"
                  variant="outlined"
                  color="primary"
                  @click="downloadDataset(selectedDatasetForVersions, version.versionNumber)"
                >
                  <v-icon start>mdi-download</v-icon>
                  Download
                </v-btn>
              </div>
            </v-timeline-item>
          </v-timeline>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
import * as XLSX from 'xlsx';

export default {
  name: 'FileUploadDashboard',
  data() {
    return {
      selectedFile: null,
      data: null,
      processing: false,
      error: null,
      dragOver: false,
      selectedSheet: null,
      displayLimit: 20,
      showRawData: false,
      // Database functionality
      saving: false,
      loadingDatasets: false,
      datasets: [],
      saveOptions: {
        name: '',
        version: '',
        description: ''
      },
      apiBaseUrl: 'http://localhost:3000/api', // Configure your backend URL
      // Notification system
      showNotification: false,
      notificationMessage: '',
      notificationColor: 'success',
      // Version history
      versionDialog: false,
      selectedDatasetForVersions: null,
      datasetVersions: [],
      loadingVersions: false
    }
  },
  mounted() {
    // Load existing datasets when component mounts
    this.loadDatasets();
  },
  methods: {
    handleFileDrop(event) {
      this.dragOver = false;
      const files = event.dataTransfer.files;
      if (files.length > 0) {
        this.selectedFile = files[0];
      }
    },

    handleFileSelect(event) {
      const files = event.target.files;
      if (files.length > 0) {
        this.selectedFile = files[0];
      }
    },

    clearFile() {
      this.selectedFile = null;
      this.data = null;
      this.error = null;
      this.selectedSheet = null;
      this.displayLimit = 20;
      this.showRawData = false;
      this.$refs.fileInput.value = '';
    },

    async processFile() {
      if (!this.selectedFile) return;

      this.processing = true;
      this.error = null;

      try {
        const fileType = this.getFileType(this.selectedFile.type);
        
        if (fileType === 'CSV') {
          await this.processCSV();
        } else if (fileType === 'Excel') {
          await this.processExcel();
        } else {
          throw new Error('Unsupported file type');
        }

        this.processing = false;
      } catch (err) {
        this.error = err.message || 'Failed to process file';
        this.processing = false;
        console.error('Error processing file:', err);
      }
    },

    async processCSV() {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const csvText = e.target.result;
            const lines = csvText.split('\n').filter(line => line.trim());
            
            if (lines.length === 0) {
              throw new Error('Empty CSV file');
            }

            const rows = lines.map(line => {
              const result = [];
              let current = '';
              let inQuotes = false;
              
              for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"') {
                  inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                  result.push(current.trim());
                  current = '';
                } else {
                  current += char;
                }
              }
              result.push(current.trim());
              return result;
            });

            const columns = rows[0];
            const dataRows = rows.slice(1);

            this.data = {
              fileName: this.selectedFile.name,
              fileType: 'CSV',
              fileSize: this.formatFileSize(this.selectedFile.size),
              processedAt: new Date(),
              sheets: [{
                name: 'Sheet1',
                columns: columns,
                rows: dataRows
              }],
              totalRows: dataRows.length,
              totalColumns: columns.length,
              totalCells: dataRows.length * columns.length
            };

            this.selectedSheet = 'Sheet1';
            resolve();
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(this.selectedFile);
      });
    },

    async processExcel() {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const workbook = XLSX.read(e.target.result, {
              type: 'array',
              cellStyles: true,
              cellFormulas: true,
              cellDates: true,
              cellNF: true,
              sheetStubs: false
            });

            const sheets = [];
            let totalRows = 0;
            let totalColumns = 0;
            let totalCells = 0;

            workbook.SheetNames.forEach(sheetName => {
              const worksheet = workbook.Sheets[sheetName];
              
              const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
                header: 1,
                defval: '',
                raw: false
              });

              if (jsonData.length > 0) {
                const columns = jsonData[0] || [];
                const rows = jsonData.slice(1);
                
                const filteredRows = rows.filter(row => 
                  row.some(cell => cell !== null && cell !== undefined && cell !== '')
                );

                const sheetData = {
                  name: sheetName,
                  columns: columns,
                  rows: filteredRows,
                  originalRowCount: rows.length,
                  filteredRowCount: filteredRows.length
                };

                sheets.push(sheetData);

                totalRows += filteredRows.length;
                if (columns.length > totalColumns) {
                  totalColumns = columns.length;
                }
                totalCells += filteredRows.length * columns.length;
              }
            });

            if (sheets.length === 0) {
              throw new Error('No valid data found in Excel file');
            }

            this.data = {
              fileName: this.selectedFile.name,
              fileType: 'Excel',
              fileSize: this.formatFileSize(this.selectedFile.size),
              processedAt: new Date(),
              sheets: sheets,
              totalRows,
              totalColumns,
              totalCells,
              workbookInfo: {
                sheetCount: workbook.SheetNames.length,
                sheetNames: workbook.SheetNames,
                hasFormulas: this.checkForFormulas(workbook),
                fileVersion: workbook.Workbook?.AppVersion?.appName || 'Unknown'
              }
            };

            this.selectedSheet = sheets[0]?.name;
            resolve();
          } catch (err) {
            console.error('Excel processing error:', err);
            reject(new Error(`Failed to process Excel file: ${err.message}`));
          }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(this.selectedFile);
      });
    },

    checkForFormulas(workbook) {
      return workbook.SheetNames.some(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        return Object.keys(worksheet).some(cellRef => {
          if (cellRef.startsWith('!')) return false;
          const cell = worksheet[cellRef];
          return cell && cell.f;
        });
      });
    },

    getCurrentSheetData() {
      if (!this.data || !this.data.sheets) return { columns: [], rows: [] };
      
      if (this.data.sheets.length === 1) {
        return this.data.sheets[0];
      }
      
      return this.data.sheets.find(sheet => sheet.name === this.selectedSheet) || this.data.sheets[0];
    },

    getFileType(mimeType) {
      if (mimeType.includes('csv') || mimeType.includes('comma-separated')) return 'CSV';
      if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'Excel';
      return 'Unknown';
    },

    getFileTypeColor(mimeType) {
      const type = this.getFileType(mimeType);
      switch (type) {
        case 'CSV': return 'success';
        case 'Excel': return 'info';
        default: return 'grey';
      }
    },

    getFileIcon(mimeType) {
      const type = this.getFileType(mimeType);
      switch (type) {
        case 'CSV': return 'mdi-file-delimited';
        case 'Excel': return 'mdi-file-excel';
        default: return 'mdi-file';
      }
    },

    formatFileSize(bytes) {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    formatDate(date) {
      if (!date) return 'N/A';
      return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    },

    formatCellValue(value) {
      if (value === null || value === undefined) return '';
      if (typeof value === 'string' && value.length > 50) {
        return value.substring(0, 50) + '...';
      }
      return value;
    },

    getColumnType(columnName) {
      const name = columnName.toLowerCase();
      const currentData = this.getCurrentSheetData();
      
      if (currentData.rows.length > 0) {
        const columnIndex = currentData.columns.indexOf(columnName);
        if (columnIndex !== -1) {
          const sampleValues = currentData.rows.slice(0, 10).map(row => row[columnIndex]).filter(val => val && val.toString().trim());
          
          if (sampleValues.length > 0) {
            if (sampleValues.some(val => val.toString().match(/^https?:\/\//))) {
              return 'URL';
            }
            
            if (sampleValues.some(val => val.toString().match(/\S+@\S+\.\S+/))) {
              return 'Email';
            }
            
            if (sampleValues.every(val => !isNaN(parseFloat(val)) && isFinite(val))) {
              return 'Number';
            }
            
            if (sampleValues.some(val => !isNaN(Date.parse(val)))) {
              return 'Date';
            }
          }
        }
      }
      
      if (name.includes('id')) return 'ID';
      if (name.includes('email')) return 'Email';
      if (name.includes('url') || name.includes('website') || name.includes('link')) return 'URL';
      if (name.includes('date') || name.includes('time')) return 'Date';
      if (name.includes('amount') || name.includes('price') || name.includes('salary') || name.includes('cost')) return 'Number';
      if (name.includes('phone') || name.includes('mobile')) return 'Phone';
      if (name.includes('address')) return 'Address';
      if (name.includes('name') || name.includes('title')) return 'Name';
      
      return 'Text';
    },

    exportData(format) {
      const currentData = this.getCurrentSheetData();
      let content = '';
      let filename = '';
      let mimeType = '';

      if (format === 'json') {
        content = JSON.stringify(currentData, null, 2);
        filename = `${this.data.fileName.split('.')[0]}_export.json`;
        mimeType = 'application/json';
      } else if (format === 'csv') {
        const csvRows = [currentData.columns.join(',')];
        currentData.rows.forEach(row => {
          csvRows.push(row.map(cell => `"${cell}"`).join(','));
        });
        content = csvRows.join('\n');
        filename = `${this.data.fileName.split('.')[0]}_export.csv`;
        mimeType = 'text/csv';
      }

      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },

    // Database Methods
    async saveToDatabase() {
      if (!this.data || !this.saveOptions.name) return;

      this.saving = true;
      this.error = null;

      try {
        // Prepare the payload according to your backend schema
        const payload = {
          name: this.saveOptions.name,
          version: this.saveOptions.version || 'v1.0',
          description: this.saveOptions.description || '',
          originalFileName: this.data.fileName,
          fileType: this.data.fileType,
          fileSize: this.selectedFile.size,
          totalRows: this.data.totalRows,
          totalColumns: this.data.totalColumns,
          totalCells: this.data.totalCells,
          sheets: this.data.sheets,
          companies: this.extractCompaniesFromData(), // Extract companies
          workbookInfo: this.data.workbookInfo || null,
          metadata: {
            uploadedAt: new Date(),
            processedAt: this.data.processedAt,
            userAgent: navigator.userAgent
          }
        };

        // Create FormData to send file + data
        const formData = new FormData();
        formData.append('file', this.selectedFile);
        formData.append('data', JSON.stringify(payload));

        const response = await fetch(`${this.apiBaseUrl}/datasets`, {
          method: 'POST',
          body: formData
        });

        console.log('the dataset form data being sent:', formData);

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        
        // Show success notification
        this.$emit('show-notification', {
          type: 'success',
          message: result.message || 'Dataset saved successfully',
          isNewVersion: result.isNewVersion
        });
        
        // Reset form
        this.saveOptions = {
          name: '',
          version: '',
          description: ''
        };

        // Reload datasets
        await this.loadDatasets();

        this.saving = false;

        // Redirect to datasets page after successful upload
        setTimeout(() => {
          this.$router.push('/datasets');
        }, 2000); // 2 second delay to show success message
      } catch (err) {
        this.error = `Failed to save dataset: ${err.message}`;
        this.saving = false;
        console.error('Error saving dataset:', err);
      }
    },

    async loadDatasets() {
      this.loadingDatasets = true;
      
      try {
        const response = await fetch(`${this.apiBaseUrl}/datasets?limit=50&sortBy=createdAt&sortOrder=desc`);
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        this.datasets = result.data || [];
        
        this.loadingDatasets = false;
      } catch (err) {
        this.error = `Failed to load datasets: ${err.message}`;
        this.loadingDatasets = false;
        console.error('Error loading datasets:', err);
      }
    },

    async loadDataset(dataset) {
      try {
        // Fetch full dataset with row data
        const response = await fetch(`${this.apiBaseUrl}/datasets/${dataset._id}?includeRows=true`);
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        const fullDataset = result.data;

        // Load the dataset data into component
        this.data = {
          fileName: fullDataset.originalFileName,
          fileType: fullDataset.fileType,
          fileSize: this.formatFileSize(fullDataset.fileSize),
          processedAt: new Date(fullDataset.metadata.processedAt || fullDataset.createdAt),
          sheets: fullDataset.sheets,
          totalRows: fullDataset.totalRows,
          totalColumns: fullDataset.totalColumns,
          totalCells: fullDataset.totalCells,
          workbookInfo: fullDataset.workbookInfo
        };

        // Set the first sheet as selected
        this.selectedSheet = fullDataset.sheets[0]?.name;
        
        // Clear current file selection
        this.selectedFile = null;
        if (this.$refs.fileInput) {
          this.$refs.fileInput.value = '';
        }

        // Show success notification
        this.$emit('show-notification', {
          type: 'success',
          message: `Dataset "${fullDataset.name}" loaded successfully`
        });
        
      } catch (err) {
        this.error = `Failed to load dataset: ${err.message}`;
        console.error('Error loading dataset:', err);
      }
    },

    async deleteDataset(datasetId) {
      const confirmed = confirm('Are you sure you want to delete this dataset? This action cannot be undone.');
      if (!confirmed) return;

      try {
        const response = await fetch(`${this.apiBaseUrl}/datasets/${datasetId}`, {
          method: 'DELETE'
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        // Remove from local list
        this.datasets = this.datasets.filter(d => d._id !== datasetId);

        // Show success notification
        this.$emit('show-notification', {
          type: 'success',
          message: result.message || 'Dataset deleted successfully'
        });
        
      } catch (err) {
        this.error = `Failed to delete dataset: ${err.message}`;
        console.error('Error deleting dataset:', err);
      }
    },

    async downloadDataset(dataset, version = null) {
      try {
        const url = version 
          ? `${this.apiBaseUrl}/datasets/${dataset._id}/download?version=${version}`
          : `${this.apiBaseUrl}/datasets/${dataset._id}/download`;

        // Create a temporary link and click it
        const link = document.createElement('a');
        link.href = url;
        link.download = version 
          ? `${dataset.name}_${version}_${dataset.originalFileName}`
          : dataset.originalFileName;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        this.$emit('show-notification', {
          type: 'success',
          message: 'Download started'
        });

      } catch (err) {
        this.error = `Failed to download dataset: ${err.message}`;
        console.error('Error downloading dataset:', err);
      }
    },

    async duplicateDataset(dataset) {
      const newName = prompt(`Enter name for duplicated dataset:`, `${dataset.name} (Copy)`);
      if (!newName) return;

      try {
        const response = await fetch(`${this.apiBaseUrl}/datasets/${dataset._id}/duplicate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: newName,
            version: 'v1.0'
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        // Reload datasets to show the new duplicate
        await this.loadDatasets();

        this.$emit('show-notification', {
          type: 'success',
          message: result.message || 'Dataset duplicated successfully'
        });

      } catch (err) {
        this.error = `Failed to duplicate dataset: ${err.message}`;
        console.error('Error duplicating dataset:', err);
      }
    },

    async viewVersions(dataset) {
      this.selectedDatasetForVersions = dataset;
      this.versionDialog = true;
      this.loadingVersions = true;
      this.datasetVersions = [];

      try {
        const response = await fetch(`${this.apiBaseUrl}/datasets/${dataset._id}/versions`);
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        this.datasetVersions = result.data.versions || [];
        
      } catch (err) {
        this.showNotificationMessage('Failed to load version history: ' + err.message, 'error');
        console.error('Error loading versions:', err);
      } finally {
        this.loadingVersions = false;
      }
    },

    showNotificationMessage(message, type = 'success') {
      this.notificationMessage = message;
      this.notificationColor = type;
      this.showNotification = true;
    },

    // Handle events from child components or external calls
    handleShowNotification(event) {
      this.showNotificationMessage(event.message, event.type);
    },

    // Extract companies from current data
    extractCompaniesFromData() {
      if (!this.data || !this.data.sheets) return [];
      
      const companies = [];
      
      this.data.sheets.forEach(sheet => {
        if (sheet.columns && sheet.rows && sheet.columns.length >= 2) {
          // Find company name and URL columns
          const nameColumnIndex = sheet.columns.findIndex(col => 
            col.toLowerCase().includes('company') || col.toLowerCase().includes('name')
          );
          const urlColumnIndex = sheet.columns.findIndex(col => 
            col.toLowerCase().includes('url') || col.toLowerCase().includes('website') || col.toLowerCase().includes('link')
          );

          // If both columns found, extract data
          if (nameColumnIndex !== -1 && urlColumnIndex !== -1) {
            sheet.rows.forEach(row => {
              const companyName = row[nameColumnIndex];
              const companyURL = row[urlColumnIndex];
              
              if (companyName && companyURL && 
                  typeof companyName === 'string' && 
                  typeof companyURL === 'string' &&
                  companyName.trim() && 
                  companyURL.trim()) {
                
                // Basic URL validation and cleanup
                const cleanURL = companyURL.trim();
                const validURL = cleanURL.startsWith('http') ? cleanURL : `https://${cleanURL}`;
                
                companies.push({
                  companyName: companyName.trim(),
                  companyURL: validURL
                });
              }
            });
          }
        }
      });

      // Remove duplicates based on company name
      const uniqueCompanies = companies.filter((company, index, self) => 
        index === self.findIndex(c => c.companyName.toLowerCase() === company.companyName.toLowerCase())
      );

      return uniqueCompanies;
    }
  }
}
</script>

<style scoped>
.heading {
  font-size: 30px;
  margin-top: 48px;
  font-weight: 700;
  color: #1F202F;
  margin-bottom: 24px;
}

.upload-card {
  margin-bottom: 24px;
}

.card-title {
  display: flex;
  align-items: center;
  font-size: 24px;
  font-weight: 600;
  color: #1F202F;
}

.title-icon {
  margin-right: 12px;
}

.upload-zone {
  border: 2px dashed #ccc;
  border-radius: 8px;
  padding: 48px 24px;
  text-align: center;
  transition: all 0.3s ease;
  cursor: pointer;
}

.upload-zone:hover,
.upload-zone.drag-over {
  border-color: #1976d2;
  background-color: rgba(25, 118, 210, 0.04);
}

.upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.upload-icon {
  opacity: 0.6;
}

.upload-title {
  font-size: 20px;
  font-weight: 600;
  color: #1F202F;
  margin: 0;
}

.upload-subtitle {
  color: #666;
  margin: 0;
}

.file-selected {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: rgba(76, 175, 80, 0.04);
  border-radius: 8px;
}

.file-icon {
  flex-shrink: 0;
}

.file-info {
  flex: 1;
  text-align: left;
}

.file-name {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 4px 0;
  color: #1F202F;
}

.file-details {
  color: #666;
  margin: 0;
  font-size: 14px;
}

.file-actions {
  display: flex;
  gap: 8px;
}

.loading-container {
  text-align: center;
  padding: 48px 0;
}

.loading-text {
  margin-top: 16px;
  font-size: 18px;
  color: #666;
}

.error-container {
  margin: 24px 0;
}

.retry-btn {
  margin-top: 16px;
}

.header-card {
  margin-bottom: 24px;
}

.info-item {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.info-icon {
  margin-right: 8px;
}

.file-chip {
  margin-left: 24px;
}

.info-detail {
  margin-bottom: 8px;
  color: #666;
}

.stats-row {
  margin-bottom: 24px;
}

.stat-card {
  text-align: center;
  padding: 24px;
}

.stat-icon {
  margin-bottom: 8px;
}

.stat-number {
  font-size: 32px;
  font-weight: bold;
  margin-bottom: 4px;
}

.stat-label {
  font-size: 14px;
  opacity: 0.8;
}

.data-card {
  margin-bottom: 24px;
}

.data-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  flex-wrap: wrap;
  gap: 16px;
}

.data-title {
  display: flex;
  align-items: center;
  font-size: 20px;
  font-weight: 600;
  color: #1F202F;
}

.data-controls {
  display: flex;
  align-items: center;
}

.table-container {
  overflow-x: auto;
  margin-bottom: 16px;
}

.data-table {
  min-width: 100%;
}

.data-header-cell {
  background-color: #f5f5f5;
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 1;
}

.column-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 120px;
}

.column-name {
  font-weight: 600;
  font-size: 14px;
}

.row-number {
  background-color: #f8f9fa;
  font-weight: 600;
  text-align: center;
  min-width: 50px;
  position: sticky;
  left: 0;
  z-index: 2;
}

.data-row:nth-child(even) {
  background-color: rgba(0, 0, 0, 0.02);
}

.data-cell {
  max-width: 200px;
  padding: 8px 12px;
}

.cell-content {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.show-more-container {
  margin-top: 16px;
}

.export-card {
  margin-top: 24px;
}

.save-card {
  margin-bottom: 24px;
}

.datasets-card {
  margin-bottom: 24px;
}

.dataset-card {
  height: 100%;
  transition: transform 0.2s ease-in-out;
}

.dataset-card:hover {
  transform: translateY(-2px);
}

.dataset-title {
  padding: 16px 16px 8px 16px;
}

.dataset-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.dataset-name {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  color: #1F202F;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.dataset-info {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.dataset-description {
  margin-top: 8px;
  padding: 8px;
  background-color: rgba(0, 0, 0, 0.04);
  border-radius: 4px;
  font-size: 12px;
  color: #666;
  font-style: italic;
}

.raw-data-container {
  margin-top: 16px;
}

.raw-data-textarea {
  font-family: 'Courier New', monospace;
  font-size: 12px;
}
</style>