// ---- Enhanced Dashboard Bootstrapping - KORRIGIERT MIT TIMER-FIX UND MM:SS FORMAT ----
// DATEI: app.js - Korrigiert für Timer-Ende-Problem und MM:SS Zeitformat

document.addEventListener('DOMContentLoaded', () => { 
  // Initialize Lucide icons first
  lucide.createIcons();
  
  // Then boot the application
  void boot(); 
});

async function boot() {
  // Enhanced State Management System
  const AppState = {
    user: null, // Aktueller Benutzer
    giveaway: {
      status: 'INACTIVE', // INACTIVE, ACTIVE, PAUSED
      keyword: '!join',
      duration: 0, // seconds (converted from MM:SS)
      timeRemaining: 0, // seconds
      entries: 0,
      subsOnly: false,
      autoJoinHost: true,
      isTimedMode: false,
      startTime: null
    },
    ui: {
      isStarting: false,
      isPicking: false,
      isResetting: false,
      timerInterval: null
    },
    settings: {
      // Load from localStorage with defaults
      keyword: localStorage.getItem('giveaway_keyword') || '!join',
      duration: localStorage.getItem('giveaway_duration_formatted') || '05:00', // MM:SS format
      durationMode: localStorage.getItem('giveaway_duration_mode') || 'manual',
      subsOnly: localStorage.getItem('giveaway_subs_only') === 'true',
      autoJoinHost: localStorage.getItem('giveaway_auto_join_host') === 'true'
    },
    winner: {
      currentWinner: null,
      messagesAfterWin: [],
      winTime: null,
      timerInterval: null
    }
  };

  // Header elements
  const header = {
    status: document.querySelector('.user .status'),
    avatar: document.querySelector('.user .avatar'),
    name: document.querySelector('.user .name'),
    logout: document.getElementById('logoutBtn'),
  };

  // Alle DOM Elemente zentral definiert
  const elements = {
    // Status panel
    statusEl: document.getElementById('status'),
    kwTag: document.getElementById('kw'),
    durationTag: document.getElementById('dur'),
    durationRow: document.querySelector('.meta li:nth-child(3)'), // Duration row
    entriesEl: document.getElementById('entries'),
    
    // Controls
    startBtn: document.getElementById('startBtn'),
    pauseBtn: document.getElementById('pauseBtn'),
    pickBtn: document.getElementById('pickBtn'),
    resetBtn: document.getElementById('resetBtn'),
    
    // Quick settings
    keywordInput: document.getElementById('keywordInput'),
    durationMode: document.getElementById('durationMode'),
    durationField: document.getElementById('durationField'),
    durationInput: document.getElementById('durationInput'),
    timeUpBtn: document.querySelector('.time-up'),
    timeDownBtn: document.querySelector('.time-down'),
    
    // Participants
    participantsList: document.getElementById('participantsList'),
    participantCount: document.getElementById('participantCount'),
    participantSearch: document.getElementById('participantSearch'),
    emptyPanel: document.getElementById('emptyPanel'),
    participantsHeader: document.querySelector('.participants-header h3'),
    
    // Chat
    chatList: document.getElementById('chatList'),
    
    // Modals and sliders
    resetConfirmToast: document.getElementById('resetConfirmToast'),
    winnerModal: document.getElementById('winnerModal'),
    toastContainer: document.getElementById('toastContainer')
  };

  // ===================== TIME FORMAT UTILITIES =====================
  const TimeUtils = {
    // Convert MM:SS string to seconds
    formatToSeconds(timeStr) {
      if (!timeStr || typeof timeStr !== 'string') return 300; // Default 5 minutes
      
      const parts = timeStr.split(':');
      if (parts.length !== 2) return 300;
      
      const minutes = parseInt(parts[0], 10) || 0;
      const seconds = parseInt(parts[1], 10) || 0;
      
      return (minutes * 60) + seconds;
    },
    
    // Convert seconds to MM:SS string
    secondsToFormat(totalSeconds) {
      const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
      const seconds = Math.max(0, totalSeconds) % 60;
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    },
    
    // Validate MM:SS format
    validateFormat(timeStr) {
      if (!timeStr || typeof timeStr !== 'string') return false;
      
      const pattern = /^[0-9]{1,2}:[0-5][0-9]$/;
      if (!pattern.test(timeStr)) return false;
      
      const parts = timeStr.split(':');
      const minutes = parseInt(parts[0], 10);
      const seconds = parseInt(parts[1], 10);
      
      // Allow 0:10 to 60:00
      return minutes >= 0 && minutes <= 60 && seconds >= 0 && seconds <= 59 && 
             (minutes > 0 || seconds >= 10); // Minimum 10 seconds
    },
    
    // Auto-format input while typing
    autoFormat(input) {
      let value = input.replace(/[^\d]/g, ''); // Remove non-digits
      
      if (value.length === 0) return '00:00';
      if (value.length === 1) return `0${value}:00`;
      if (value.length === 2) return `${value}:00`;
      if (value.length === 3) return `${value.slice(0, 2)}:${value.slice(2, 3)}0`;
      if (value.length >= 4) return `${value.slice(0, 2)}:${value.slice(2, 4)}`;
      
      return value;
    },
    
    // Increment time by 10 seconds
    incrementTime(timeStr, increment = 10) {
      const seconds = this.formatToSeconds(timeStr);
      const newSeconds = Math.min(3600, seconds + increment); // Max 60:00
      return this.secondsToFormat(newSeconds);
    },
    
    // Decrement time by 10 seconds
    decrementTime(timeStr, decrement = 10) {
      const seconds = this.formatToSeconds(timeStr);
      const newSeconds = Math.max(10, seconds - decrement); // Min 0:10
      return this.secondsToFormat(newSeconds);
    }
  };

  // Validation System (erweitert für MM:SS)
const Validators = {
  keyword(keyword) {
    const kw = String(keyword || '').trim();
    if (!kw) return { valid: false, error: 'Keyword cannot be empty' };
    if (kw.length < 1) return { valid: false, error: 'Keyword too short' };
    if (kw.length > 25) return { valid: false, error: 'Keyword too long (max 50 characters)' };
    if (!/^[!#@$%&*]?[a-zA-Z0-9_\s-]+$/.test(kw)) return { valid: false, error: 'Invalid characters in keyword' };
    return { valid: true };
  },
  
  duration(timeStr) {
    if (!TimeUtils.validateFormat(timeStr)) {
      return { valid: false, error: 'Invalid time format. Use MM:SS (e.g., 05:00)' };
    }
    
    const seconds = TimeUtils.formatToSeconds(timeStr);
    if (seconds < 10) return { valid: false, error: 'Duration must be at least 10 seconds' };
    if (seconds > 3600) return { valid: false, error: 'Duration cannot exceed 60 minutes' };
    
    return { valid: true };
  }
};

  // Enhanced Timer Management System (KORRIGIERT)
  const TimerManager = {
    start(durationSeconds) {
      this.stop();
      
      AppState.giveaway.timeRemaining = durationSeconds;
      AppState.giveaway.isTimedMode = true;
      
      console.log(`⏰ Timer started for ${durationSeconds} seconds (${TimeUtils.secondsToFormat(durationSeconds)})`);
      
      AppState.ui.timerInterval = setInterval(() => {
        if (AppState.giveaway.status === 'PAUSED') {
          return;
        }
        
        AppState.giveaway.timeRemaining = Math.max(0, AppState.giveaway.timeRemaining - 1);
        this.updateDisplay();
        
        if (AppState.giveaway.timeRemaining <= 0) {
          this.onTimerEnd();
        }
      }, 1000);
      
      this.updateDisplay();
    },
    
    stop() {
      if (AppState.ui.timerInterval) {
        clearInterval(AppState.ui.timerInterval);
        AppState.ui.timerInterval = null;
      }
      AppState.giveaway.timeRemaining = 0;
      AppState.giveaway.isTimedMode = false;
      this.updateDisplay();
    },
    
    pause() {
      console.log('⏸️ Timer paused at:', TimeUtils.secondsToFormat(AppState.giveaway.timeRemaining));
    },
    
    resume() {
      console.log('▶️ Timer resumed at:', TimeUtils.secondsToFormat(AppState.giveaway.timeRemaining));
    },
    
    updateDisplay() {
      const timeString = TimeUtils.secondsToFormat(AppState.giveaway.timeRemaining);
      
      if (elements.durationTag && AppState.giveaway.isTimedMode) {
        elements.durationTag.textContent = timeString;
        
        elements.durationTag.className = '';
        if (AppState.giveaway.timeRemaining <= 60 && AppState.giveaway.timeRemaining > 30) {
          elements.durationTag.classList.add('timer-warning');
        } else if (AppState.giveaway.timeRemaining <= 30 && AppState.giveaway.timeRemaining > 0) {
          elements.durationTag.classList.add('timer-critical');
        }
      }
    },
    
    // ✅ KORRIGIERT: Verbesserte Timer-Ende Logik
    async onTimerEnd() {
      console.log('⏰ Timer ended - Stopping timer and checking participants');
      this.stop(); // Stoppe Timer sofort
      
      // Prüfe aktuellen Status
      if (AppState.giveaway.status !== 'ACTIVE') {
        console.log('⚠️ Timer ended but giveaway not active, ignoring');
        return;
      }
      
      console.log(`📊 Timer ended with ${AppState.giveaway.entries} participants`);
      
      if (AppState.giveaway.entries > 0) {
        console.log('🎯 Auto-picking winner due to timer end');
        
        // Setze Status auf PAUSED um weitere Teilnahmen zu verhindern
        StateManager.updateStatus('PAUSED');
        
        // Kurze Verzögerung für UI Update, dann Winner ziehen
        setTimeout(async () => {
          try {
            // Verwende die Server API für korrekten Winner Pick
            await EventHandlers.pickWinner();
          } catch (error) {
            console.error('❌ Failed to pick winner on timer end:', error);
            UIManager.showToast('Failed to pick winner automatically', 'error');
            StateManager.updateStatus('INACTIVE');
          }
        }, 500);
      } else {
        console.log('❌ Timer ended with no participants');
        StateManager.updateStatus('INACTIVE');
        UIManager.showToast('Giveaway ended - No participants joined', 'error');
      }
    }
  };

  // Enhanced State Management System
  const StateManager = {
    updateStatus(newStatus, data = {}) {
      const oldStatus = AppState.giveaway.status;
      AppState.giveaway.status = newStatus;
      
      console.log(`📄 Status changed: ${oldStatus} → ${newStatus}`, data);
      
      this.updateStatusDisplay();
      this.updateButtonStates();
      this.updateDurationDisplay();
      
      switch (newStatus) {
        case 'ACTIVE':
          this.onGiveawayStart(data);
          break;
        case 'PAUSED':
          this.onGiveawayPause();
          break;
        case 'INACTIVE':
          this.onGiveawayStop();
          break;
      }
    },
    
    updateStatusDisplay() {
      if (!elements.statusEl) return;
      
      let statusText = 'INACTIVE';
      let statusClass = 'tag--gray';
      
      switch (AppState.giveaway.status) {
        case 'ACTIVE':
          statusText = 'ACTIVE';
          statusClass = 'tag--success';
          break;
        case 'PAUSED':
          statusText = 'PAUSED';
          statusClass = 'tag--warn';
          break;
        default:
          statusText = 'INACTIVE';
          statusClass = 'tag--gray';
      }
      
      elements.statusEl.textContent = statusText;
      elements.statusEl.className = `tag status-text ${statusClass}`;
    },
    
    updateDurationDisplay() {
      if (!elements.durationRow) return;
      
      const shouldShow = (AppState.giveaway.status === 'ACTIVE' || AppState.giveaway.status === 'PAUSED') && AppState.giveaway.isTimedMode;
      
      if (shouldShow) {
        elements.durationRow.style.display = 'flex';
        TimerManager.updateDisplay();
      } else {
        elements.durationRow.style.display = 'none';
      }
    },
    
    updateButtonStates() {
      if (!elements.startBtn || !elements.pauseBtn || !elements.pickBtn || !elements.resetBtn) return;
      
      elements.startBtn.className = 'btn btn--primary';
      elements.pauseBtn.className = 'btn btn--warn';
      elements.pickBtn.className = 'btn btn--success';
      elements.resetBtn.className = 'btn btn--ghost';
      
      switch (AppState.giveaway.status) {
        case 'ACTIVE':
          elements.startBtn.className = 'btn btn--gray btn--active';
          elements.startBtn.innerHTML = '<i data-lucide="square"></i> Giveaway Active';
          elements.startBtn.disabled = true;
          
          elements.pauseBtn.className = 'btn btn--orange';
          elements.pauseBtn.innerHTML = '<i data-lucide="pause"></i> Pause';
          elements.pauseBtn.disabled = false;
          
          elements.pickBtn.disabled = false;
          elements.resetBtn.disabled = false;
          break;
          
        case 'PAUSED':
          elements.startBtn.className = 'btn btn--primary';
          elements.startBtn.innerHTML = '<i data-lucide="play"></i> Resume Giveaway';
          elements.startBtn.disabled = false;
          
          elements.pauseBtn.className = 'btn btn--gray';
          elements.pauseBtn.innerHTML = '<i data-lucide="pause"></i> Pause';
          elements.pauseBtn.disabled = true;
          
          elements.pickBtn.className = 'btn btn--success';
          elements.pickBtn.disabled = false;
          elements.resetBtn.disabled = false;
          break;
          
        default:
          elements.startBtn.className = 'btn btn--primary';
          elements.startBtn.innerHTML = '<i data-lucide="play"></i> Start Giveaway';
          elements.startBtn.disabled = AppState.ui.isStarting;
          
          elements.pauseBtn.className = 'btn btn--warn';
          elements.pauseBtn.innerHTML = '<i data-lucide="pause"></i> Pause';
          elements.pauseBtn.disabled = true;
          
          elements.pickBtn.disabled = AppState.giveaway.entries === 0;
          elements.resetBtn.disabled = true;
          break;
      }
      
      lucide.createIcons();
    },
    
    onGiveawayStart(data) {
      this.updateParticipantsHeader();
      
      if (data.durationSeconds && data.durationSeconds > 0 && AppState.giveaway.status !== 'PAUSED') {
        TimerManager.start(data.durationSeconds);
      }
    },
    
    onGiveawayPause() {
      TimerManager.pause();
    },
    
    onGiveawayStop() {
      TimerManager.stop();
      AppState.giveaway.entries = 0;
      this.updateEntriesDisplay();
      this.updateParticipantsHeader();
    },
    
    updateParticipantsHeader() {
      if (!elements.participantsHeader) return;
      
      const baseText = 'Participants';
      const countElement = `<span class="participant-count" id="participantCount" aria-live="polite">${AppState.giveaway.entries}</span>`;
      
      if (AppState.giveaway.status === 'ACTIVE' || AppState.giveaway.status === 'PAUSED') {
        const keywordInfo = `<span class="keyword-hint">Type <code>${AppState.giveaway.keyword}</code> to enter</span>`;
        elements.participantsHeader.innerHTML = `
          <i data-lucide="users" aria-hidden="true"></i>
          ${baseText}
          ${countElement}
          ${keywordInfo}
        `;
      } else {
        elements.participantsHeader.innerHTML = `
          <i data-lucide="users" aria-hidden="true"></i>
          ${baseText}
          ${countElement}
        `;
      }
      
      lucide.createIcons(elements.participantsHeader);
      elements.participantCount = document.getElementById('participantCount');
    },
    
    updateEntriesDisplay() {
      const count = String(AppState.giveaway.entries);
      
      if (elements.entriesEl) {
        elements.entriesEl.textContent = count;
        elements.entriesEl.classList.add('entries-updating');
        setTimeout(() => elements.entriesEl.classList.remove('entries-updating'), 500);
      }
      if (elements.participantCount) elements.participantCount.textContent = count;
    },
    
    updateKeywordDisplay() {
      if (elements.kwTag) elements.kwTag.textContent = AppState.giveaway.keyword;
      if (elements.keywordInput) elements.keywordInput.value = AppState.giveaway.keyword;
    }
  };

  // Enhanced UI Management
  const UIManager = {
showResetConfirmation() {
  if (!elements.toastContainer) return;
  
  const resetToast = document.createElement('div');
  resetToast.className = 'toast toast--danger reset-toast';
  resetToast.id = 'activeResetToast';
  resetToast.innerHTML = `
    <div class="toast-content reset-content">
      <i data-lucide="alert-triangle" aria-hidden="true"></i>
      <span class="reset-text">Reset Giveaway?</span>
      <div class="reset-actions">
        <button id="confirmReset" class="btn btn--danger btn--small">
          <i data-lucide="check" aria-hidden="true"></i>
          Yes
        </button>
        <button id="cancelReset" class="btn btn--ghost btn--small">
          <i data-lucide="x" aria-hidden="true"></i>
          Cancel
        </button>
      </div>
    </div>
  `;
  
  elements.toastContainer.appendChild(resetToast);
  lucide.createIcons(resetToast);
  
  // Event Listeners für die Buttons
  resetToast.querySelector('#confirmReset').addEventListener('click', EventHandlers.confirmReset);
  resetToast.querySelector('#cancelReset').addEventListener('click', () => {
    this.hideResetConfirmation();
    EventHandlers.cancelReset();
  });
  
  setTimeout(() => resetToast.classList.add('toast--show'), 10);
  console.log('⚠️ Reset confirmation shown in toast container');
},

hideResetConfirmation() {
  const resetToast = document.getElementById('activeResetToast');
  if (resetToast) {
    resetToast.classList.remove('toast--show');
    setTimeout(() => resetToast.remove(), 300);
    console.log('⚠️ Reset confirmation hidden');
  }
},
    
    showToast(message, type = 'success') {
      if (!elements.toastContainer) return;

      const toast = document.createElement('div');
      toast.className = `toast toast--${type}`;
      toast.innerHTML = `
        <div class="toast-content">
          <i data-lucide="${type === 'success' ? 'check' : 'alert-circle'}"></i>
          <span>${message}</span>
        </div>
      `;
      
      elements.toastContainer.appendChild(toast);
      lucide.createIcons(toast);
      
      setTimeout(() => toast.classList.add('toast--show'), 10);
      
      setTimeout(() => {
        toast.classList.remove('toast--show');
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    }
  };

  // Settings Management System
  const SettingsManager = {
    currentSettings: {
      luck: {
        enabled: true,
        bits: [
          { min: 1000, mult: 1.2 },
          { min: 5000, mult: 1.5 },
          { min: 10000, mult: 2.0 },
          { min: 25000, mult: 3.0 },
          { min: 50000, mult: 4.0 },
          { min: 100000, mult: 5.0 },
          { min: 1000000, mult: 10.0 }
        ],
        subs: [
          { min: 1, mult: 1.2 },
          { min: 3, mult: 1.5 },
          { min: 6, mult: 2.0 },
          { min: 9, mult: 2.5 },
          { min: 12, mult: 3.0 },
          { min: 18, mult: 3.5 },
          { min: 24, mult: 4.0 }
        ]
      },
      general: {
        autoJoinHost: true,
        antispam: true
      }
    },

    async loadSettings() {
      try {
        console.log('⚙️ Loading settings from server...');
        
        // Lade Luck Settings
        const luckResponse = await fetch('/api/settings/luck');
        if (luckResponse.ok) {
          this.currentSettings.luck = await luckResponse.json();
          console.log('💎 Loaded luck settings:', this.currentSettings.luck);
        }

        // Lade General Settings
        const generalResponse = await fetch('/api/settings/general');
        if (generalResponse.ok) {
          this.currentSettings.general = await generalResponse.json();
          console.log('⚡️ Loaded general settings:', this.currentSettings.general);
        }

        this.updateSettingsUI();
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    },

    updateSettingsUI() {
      console.log('⚙️ Updating settings UI...');
      
      // Update Bit Badge Sliders
      const bitSliders = document.querySelectorAll('[data-bits-range]');
      bitSliders.forEach(slider => {
        const minValue = parseInt(slider.dataset.min);
        const setting = this.currentSettings.luck.bits.find(b => b.min === minValue);
        if (setting) {
          slider.value = setting.mult;
          const output = slider.parentElement.querySelector('o');
          if (output) {
            output.textContent = `${setting.mult.toFixed(2)}x`;
          }
          console.log(`💎 Updated bit slider for ${minValue}: ${setting.mult}x`);
        }
      });

      // Update Subscription Sliders
      const subSliders = document.querySelectorAll('[data-subs-range]');
      subSliders.forEach(slider => {
        const minValue = parseInt(slider.dataset.min);
        const setting = this.currentSettings.luck.subs.find(s => s.min === minValue);
        if (setting) {
          slider.value = setting.mult;
          const output = slider.parentElement.querySelector('o');
          if (output) {
            output.textContent = `${setting.mult.toFixed(2)}x`;
          }
          console.log(`👑 Updated sub slider for ${minValue}: ${setting.mult}x`);
        }
      });

      // Update General Settings
      const autoJoinCheckbox = document.getElementById('settingsAutoJoinHost');
      const antispamCheckbox = document.getElementById('antispam');
      
      if (autoJoinCheckbox) {
        autoJoinCheckbox.checked = this.currentSettings.general.autoJoinHost;
      }
      if (antispamCheckbox) {
        antispamCheckbox.checked = this.currentSettings.general.antispam;
      }
    },

    initializeSliderEvents() {
      // Bit Badge Slider Events
      const bitSliders = document.querySelectorAll('[data-bits-range]');
      bitSliders.forEach(slider => {
        slider.addEventListener('input', (e) => {
          const value = parseFloat(e.target.value);
          const output = e.target.parentElement.querySelector('o');
          if (output) {
            output.textContent = `${value.toFixed(2)}x`;
          }

          const minValue = parseInt(e.target.dataset.min);
          const setting = this.currentSettings.luck.bits.find(b => b.min === minValue);
          if (setting) {
            setting.mult = value;
          }
        });
      });

      // Subscription Slider Events
      const subSliders = document.querySelectorAll('[data-subs-range]');
      subSliders.forEach(slider => {
        slider.addEventListener('input', (e) => {
          const value = parseFloat(e.target.value);
          const output = e.target.parentElement.querySelector('o');
          if (output) {
            output.textContent = `${value.toFixed(2)}x`;
          }

          const minValue = parseInt(e.target.dataset.min);
          const setting = this.currentSettings.luck.subs.find(s => s.min === minValue);
          if (setting) {
            setting.mult = value;
          }
        });
      });

      // General Settings Events
      const autoJoinCheckbox = document.getElementById('settingsAutoJoinHost');
      const antispamCheckbox = document.getElementById('antispam');

      if (autoJoinCheckbox) {
        autoJoinCheckbox.addEventListener('change', (e) => {
          this.currentSettings.general.autoJoinHost = e.target.checked;
        });
      }

      if (antispamCheckbox) {
        antispamCheckbox.addEventListener('change', (e) => {
          this.currentSettings.general.antispam = e.target.checked;
        });
      }

      // Save Settings Button
      const saveButton = document.getElementById('saveSettings');
      if (saveButton) {
        saveButton.addEventListener('click', () => {
          this.saveSettings();
        });
      }
    },

    async saveSettings() {
      const saveButton = document.getElementById('saveSettings');
      const saveText = saveButton?.querySelector('.save-text');
      const saveIcon = saveButton?.querySelector('i');
      
      try {
        if (saveButton) {
          saveButton.disabled = true;
          saveButton.classList.add('loading');
          if (saveText) saveText.textContent = 'Saving...';
          if (saveIcon) saveIcon.setAttribute('data-lucide', 'loader-2');
          lucide.createIcons(saveButton);
        }
        
        console.log('💾 Saving all settings to server...', this.currentSettings);
        
        const luckResponse = await fetch('/api/settings/luck', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.currentSettings.luck)
        });

        const generalResponse = await fetch('/api/settings/general', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.currentSettings.general)
        });

        if (luckResponse.ok && generalResponse.ok) {
          if (saveButton) {
            saveButton.classList.remove('loading');
            saveButton.classList.add('btn--success');
            if (saveText) saveText.textContent = 'Saved!';
            if (saveIcon) saveIcon.setAttribute('data-lucide', 'check');
            lucide.createIcons(saveButton);
          }
          
          UIManager.showToast('Settings saved and applied successfully!', 'success');
          console.log('✅ All settings saved and applied:', this.currentSettings);
          
          AppState.settings.autoJoinHost = this.currentSettings.general.autoJoinHost;
          
          setTimeout(() => {
            if (saveButton) {
              saveButton.disabled = false;
              saveButton.classList.remove('btn--success');
              if (saveText) saveText.textContent = 'Save Settings';
              if (saveIcon) saveIcon.setAttribute('data-lucide', 'save');
              lucide.createIcons(saveButton);
            }
          }, 2000);
          
        } else {
          throw new Error('Failed to save settings');
        }
      } catch (error) {
        console.error('❌ Failed to save settings:', error);
        UIManager.showToast('Failed to save settings', 'error');
        
        if (saveButton) {
          saveButton.disabled = false;
          saveButton.classList.remove('loading');
          if (saveText) saveText.textContent = 'Save Settings';
          if (saveIcon) saveIcon.setAttribute('data-lucide', 'save');
          lucide.createIcons(saveButton);
        }
      }
    },

loadUISettings() {
  if (elements.keywordInput) elements.keywordInput.value = AppState.settings.keyword;
  if (elements.durationMode) {
    elements.durationMode.value = 'manual'; // ✅ KORRIGIERT: Immer Manual
    AppState.settings.durationMode = 'manual';
  }
  if (elements.durationInput) elements.durationInput.value = AppState.settings.duration;
  
  this.toggleDurationField();
  
  AppState.giveaway.keyword = AppState.settings.keyword;
  StateManager.updateKeywordDisplay();
},
    
    saveSettingsToStorage() {
      localStorage.setItem('giveaway_keyword', AppState.settings.keyword);
      localStorage.setItem('giveaway_duration_formatted', AppState.settings.duration);
      localStorage.setItem('giveaway_duration_mode', AppState.settings.durationMode);
      localStorage.setItem('giveaway_subs_only', AppState.settings.subsOnly);
      localStorage.setItem('giveaway_auto_join_host', AppState.settings.autoJoinHost);
    },
    
validateAndUpdateKeyword(keyword) {
  const processedKeyword = String(keyword || '').trim();
  
  const validation = Validators.keyword(processedKeyword);
  
  if (!validation.valid) {
    UIManager.showToast(validation.error, 'error');
    return false;
  }
  
  AppState.settings.keyword = processedKeyword.toLowerCase();
      
      if (AppState.giveaway.status === 'INACTIVE') {
        AppState.giveaway.keyword = AppState.settings.keyword;
        StateManager.updateKeywordDisplay();
      }
      
      return true;
    },
    
    validateAndUpdateDuration(timeStr) {
      const validation = Validators.duration(timeStr);
      
      if (!validation.valid) {
        UIManager.showToast(validation.error, 'error');
        return false;
      }
      
      AppState.settings.duration = timeStr;
      this.saveSettingsToStorage();
      return true;
    },
    
    toggleDurationField() {
      if (!elements.durationField || !elements.durationMode) return;
      
      if (elements.durationMode.value === 'timed') {
        elements.durationField.style.display = 'block';
        AppState.settings.durationMode = 'timed';
      } else {
        elements.durationField.style.display = 'none';
        AppState.settings.durationMode = 'manual';
      }
      
      this.saveSettingsToStorage();
    },
    
    getStartSettings() {
      const keyword = elements.keywordInput?.value?.trim() || AppState.settings.keyword;
      const isTimedMode = elements.durationMode?.value === 'timed';
      const durationStr = isTimedMode ? (elements.durationInput?.value || AppState.settings.duration) : '00:00';
      const durationSeconds = isTimedMode ? TimeUtils.formatToSeconds(durationStr) : 0;
      const subsOnly = AppState.settings.subsOnly;
      const autoJoinHost = SettingsManager.currentSettings.general.autoJoinHost || false;
      
      if (!Validators.keyword(keyword).valid) {
        throw new Error('Invalid keyword settings');
      }
      
      if (isTimedMode && !Validators.duration(durationStr).valid) {
        throw new Error('Invalid duration settings');
      }
      
      return { keyword, durationSeconds, subsOnly, autoJoinHost, isTimedMode };
    }
  };

  // Enhanced Winner Modal Functions
  async function loadUserInfo(userId, login) {
    try {
      const response = await fetch(`/api/user-info/${userId}?login=${login}`);
      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      console.error('Failed to load user info:', e);
    }
    return null;
  }

  function formatDate(dateString) {
    if (!dateString) return 'Unknown';
    
    const date = new Date(dateString);
    
    const options = { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    };
    
    const formatted = date.toLocaleDateString('en-US', options);
    
    const day = date.getDate();
    let suffix = 'th';
    
    if (day === 1 || day === 21 || day === 31) suffix = 'st';
    else if (day === 2 || day === 22) suffix = 'nd';  
    else if (day === 3 || day === 23) suffix = 'rd';
    
    return formatted.replace(/(\d+)/, `$1${suffix}`);
  }

  function formatRelativeTime(dateString) {
    if (!dateString) return 'Unknown';
    
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffMinutes = Math.floor(diffTime / (1000 * 60));
    const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffMinutes < 60) {
      return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else {
      return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    }
  }

  // Enhanced Event Handlers
  const EventHandlers = {
    async startGiveaway() {
  if (AppState.ui.isStarting || AppState.giveaway.status === 'ACTIVE') {
    console.log('🎬 Start already in progress or giveaway active');
    return;
  }
  
  // ✅ KORRIGIERT: Warte bis Settings vollständig geladen sind
  if (!SettingsManager.currentSettings || !SettingsManager.currentSettings.general) {
    console.log('⏳ Settings not loaded yet, waiting...');
    UIManager.showToast('Please wait for settings to load', 'error');
    return;
  }
  
  AppState.ui.isStarting = true;
  StateManager.updateButtonStates();
  
  try {
    const settings = SettingsManager.getStartSettings();
        console.log('🎬 Starting giveaway with settings:', settings);
        
// ✅ KORRIGIERT: Verwende aktuelle Settings für autoJoinHost
const currentAutoJoin = SettingsManager.currentSettings.general.autoJoinHost || false;

const res = await fetch('/api/giveaway/start', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    keyword: settings.keyword,
    duration: Math.floor(settings.durationSeconds / 60), // Convert to minutes for server
    subsOnly: settings.subsOnly,
    autoJoinHost: currentAutoJoin
  })
});
        
        if (res.ok) {
          AppState.giveaway.keyword = settings.keyword;
          AppState.giveaway.duration = settings.durationSeconds;
          AppState.giveaway.subsOnly = settings.subsOnly;
          AppState.giveaway.autoJoinHost = settings.autoJoinHost;
          AppState.giveaway.isTimedMode = settings.isTimedMode;
          
          StateManager.updateStatus('ACTIVE', { durationSeconds: settings.durationSeconds });
          UIManager.showToast('Giveaway started successfully!');
        } else {
          throw new Error('Failed to start giveaway');
        }
      } catch (e) {
        console.error('❌ Start failed:', e);
        UIManager.showToast('Failed to start giveaway: ' + e.message, 'error');
      } finally {
        AppState.ui.isStarting = false;
        StateManager.updateButtonStates();
      }
    },
    
    async pauseResumeGiveaway() {
      try {
        let endpoint;
        let actionName;
        
        if (AppState.giveaway.status === 'ACTIVE') {
          endpoint = '/api/giveaway/pause';
          actionName = 'pause';
        } else if (AppState.giveaway.status === 'PAUSED') {
          endpoint = '/api/giveaway/resume';
          actionName = 'resume';
        } else {
          console.log('🎬 Cannot pause/resume - giveaway not active');
          return;
        }
        
        console.log(`🎮 Attempting to ${actionName} giveaway... Current status:`, AppState.giveaway.status);
        const res = await fetch(endpoint, { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (res.ok) {
          const data = await res.json();
          console.log(`✅ ${actionName} request successful:`, data);
          UIManager.showToast(`Giveaway ${actionName}d successfully!`);
        } else {
          const errorData = await res.json().catch(() => ({}));
          console.error(`❌ ${actionName} failed:`, res.status, errorData);
          throw new Error(`Server responded with status ${res.status}: ${errorData.error || 'Unknown error'}`);
        }
      } catch (e) {
        console.error(`❌ ${AppState.giveaway.status === 'ACTIVE' ? 'Pause' : 'Resume'} failed:`, e);
        UIManager.showToast(`Failed to ${AppState.giveaway.status === 'ACTIVE' ? 'pause' : 'resume'} giveaway: ${e.message}`, 'error');
      }
    },
    
    async pickWinner() {
      if (AppState.ui.isPicking) {
        console.log('🎯 Pick already in progress, ignoring');
        return;
      }
      
      if (AppState.giveaway.entries === 0) {
        UIManager.showToast('No participants to pick from!', 'error');
        return;
      }
      
      AppState.ui.isPicking = true;
      StateManager.updateButtonStates();
      
      try {
        console.log(`🏆 Picking winner from ${AppState.giveaway.entries} participants`);
        
        const res = await fetch('/api/giveaway/end', { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(`Server error: ${res.status} - ${errorData.error || 'Unknown error'}`);
        }
        
        const data = await res.json();
        
        if (data.winner) {
          console.log('🎉 Winner selected:', data.winner.displayName || data.winner.login);
          StateManager.updateStatus('INACTIVE');
          UIManager.showToast(`Winner selected: ${data.winner.displayName || data.winner.login}!`, 'success');
        } else if (data.error === 'no_participants') {
          console.log('❌ No participants error from server');
          UIManager.showToast('No participants to pick from!', 'error');
          StateManager.updateStatus('INACTIVE');
        } else {
          throw new Error('Unexpected response from server');
        }
      } catch (e) {
        console.error('❌ Pick winner failed:', e);
        UIManager.showToast('Failed to pick winner: ' + e.message, 'error');
        // Bei Fehler zurück zu ACTIVE oder PAUSED je nach vorherigem Status
        if (AppState.giveaway.isTimedMode && AppState.giveaway.timeRemaining > 0) {
          StateManager.updateStatus('ACTIVE');
        } else {
          StateManager.updateStatus('INACTIVE');
        }
      } finally {
        AppState.ui.isPicking = false;
        StateManager.updateButtonStates();
      }
    },
    
    showResetConfirmation() {
      if (AppState.giveaway.status === 'INACTIVE') return;
      UIManager.showResetConfirmation();
    },
    
    async confirmReset() {
      if (AppState.ui.isResetting) return;
      
      AppState.ui.isResetting = true;
      UIManager.hideResetConfirmation();
      
      try {
        TimerManager.stop();
        
        const res = await fetch('/api/giveaway/stop', { method: 'POST' });
        if (res.ok) {
          StateManager.updateStatus('INACTIVE');
          UIManager.showToast('Giveaway reset successfully');
          console.log('✅ Giveaway reset completed');
        }
      } catch (e) {
        console.error('❌ Reset failed:', e);
        UIManager.showToast('Failed to reset giveaway', 'error');
      } finally {
        AppState.ui.isResetting = false;
      }
    },
    
    cancelReset() {
      UIManager.hideResetConfirmation();
      console.log('❌ Reset cancelled');
    }
  };

  // Time Input Event Handlers
  const TimeInputHandlers = {
    initializeTimeInput() {
      if (!elements.durationInput) return;
      
      // Format input on blur
      elements.durationInput.addEventListener('blur', (e) => {
        let value = e.target.value.trim();
        
        if (!value) {
          value = '05:00';
        } else if (!TimeUtils.validateFormat(value)) {
          // Try to auto-format if possible
          value = TimeUtils.autoFormat(value) || '05:00';
        }
        
        e.target.value = value;
        SettingsManager.validateAndUpdateDuration(value);
      });
      
      // Real-time validation feedback
      elements.durationInput.addEventListener('input', (e) => {
        const value = e.target.value;
        const validation = Validators.duration(value);
        
        e.target.classList.toggle('valid', validation.valid);
        e.target.classList.toggle('invalid', !validation.valid);
      });
      
      // Handle arrow key navigation and formatting
      elements.durationInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          
          const currentValue = e.target.value || '05:00';
          let newValue;
          
          if (e.key === 'ArrowUp') {
            newValue = TimeUtils.incrementTime(currentValue, 10);
          } else {
            newValue = TimeUtils.decrementTime(currentValue, 10);
          }
          
          e.target.value = newValue;
          SettingsManager.validateAndUpdateDuration(newValue);
          
          // Trigger visual feedback
          e.target.classList.add('valid');
          e.target.classList.remove('invalid');
        }
      });
      
      // Initialize up/down buttons
      if (elements.timeUpBtn) {
        elements.timeUpBtn.addEventListener('click', () => {
          const currentValue = elements.durationInput.value || '05:00';
          const newValue = TimeUtils.incrementTime(currentValue, 10);
          elements.durationInput.value = newValue;
          SettingsManager.validateAndUpdateDuration(newValue);
        });
      }
      
      if (elements.timeDownBtn) {
        elements.timeDownBtn.addEventListener('click', () => {
          const currentValue = elements.durationInput.value || '05:00';
          const newValue = TimeUtils.decrementTime(currentValue, 10);
          elements.durationInput.value = newValue;
          SettingsManager.validateAndUpdateDuration(newValue);
        });
      }
    }
  };

  // Enhanced Winner Modal Functions
  async function showWinnerModal(winner) {
    const existingModal = document.querySelector('.modal--show');
    if (existingModal) {
      console.log('Modal already open, closing previous one');
      existingModal.classList.remove('modal--show');
    }
    
    const confettiContainer = document.getElementById('confettiContainer');
    if (confettiContainer) {
      confettiContainer.innerHTML = '';
      console.log('🎉 Cleared previous confetti');
    }
    
    AppState.winner.currentWinner = winner;
    AppState.winner.winTime = new Date();
    AppState.winner.messagesAfterWin = [];
    
    if (AppState.winner.timerInterval) {
      clearInterval(AppState.winner.timerInterval);
      AppState.winner.timerInterval = null;
    }
      
    const modal = document.getElementById('winnerModal');
    const winnerName = document.getElementById('winnerName');
    const winnerAvatar = document.getElementById('winnerAvatar');
    const winnerAvatarFallback = document.getElementById('winnerAvatarFallback');
    const winnerLuck = document.getElementById('winnerLuck');
    const winnerUserInfo = document.getElementById('winnerUserInfo');
    
    if (!modal || !winnerName) return;

    winnerName.textContent = winner.displayName || winner.login;
    
    // Profilbild setzen - mit Fallback
    if (winner.profileImageUrl && winnerAvatar) {
      winnerAvatar.src = winner.profileImageUrl;
      winnerAvatar.style.display = 'block';
      if (winnerAvatarFallback) winnerAvatarFallback.style.display = 'none';
      console.log('🖼️ Setting winner avatar:', winner.profileImageUrl);
      
      winnerAvatar.onerror = () => {
        console.log('❌ Failed to load winner avatar, using fallback');
        winnerAvatar.style.display = 'none';
        if (winnerAvatarFallback) {
          winnerAvatarFallback.style.display = 'flex';
          winnerAvatarFallback.textContent = (winner.displayName || winner.login).charAt(0).toUpperCase();
        }
      };
    } else {
      if (winnerAvatar) winnerAvatar.style.display = 'none';
      if (winnerAvatarFallback) {
        winnerAvatarFallback.style.display = 'flex';
        winnerAvatarFallback.textContent = (winner.displayName || winner.login).charAt(0).toUpperCase();
      }
      console.log('⚠️ No profile image for winner, using fallback');
    }
    
    if (winnerLuck) {
      if (winner.luck && winner.luck > 1) {
        winnerLuck.textContent = `${winner.luck.toFixed(2)}x Luck`;
        winnerLuck.style.display = 'block';
      } else {
        winnerLuck.style.display = 'none';
      }
    }

    // Load and display user info
    if (winner.userId) {
      try {
        const userInfo = await loadUserInfo(winner.userId, winner.login);
        
        if (userInfo) {
          const createdAtEl = document.getElementById('winnerCreatedAt');
          
          if (createdAtEl) {
            if (userInfo.createdAt) {
              createdAtEl.textContent = formatDate(userInfo.createdAt);
            } else {
              createdAtEl.textContent = 'Unknown';
            }
          }
        } else {
          const createdAtEl = document.getElementById('winnerCreatedAt');
          if (createdAtEl) {
            createdAtEl.textContent = 'Unable to load';
          }
        }
      } catch (e) {
        console.error('Failed to load user info:', e);
        const createdAtEl = document.getElementById('winnerCreatedAt');
        if (createdAtEl) {
          createdAtEl.textContent = 'Error loading data';
        }
      }
    }

    modal.classList.add('modal--show');
    createConfetti();
    
    // Start timer display
    const timerElement = document.getElementById('winner-timer');
    if (timerElement) {
      timerElement.textContent = '00:00';
      
      AppState.winner.timerInterval = setInterval(() => {
        if (!AppState.winner.winTime) return;
        
        const now = new Date();
        const elapsed = Math.floor((now - AppState.winner.winTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        
        timerElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      }, 1000);
    }
    
    console.log('🏆 Winner modal opened for:', winner.displayName || winner.login);
  }

  // Statuspoint helper
  function setStatus(cls) {
    if (!header.status) return;
    header.status.className = `status ${cls || ''}`;
  }

  // ===================== INITIALIZE SOCKET.IO MIT AUTHENTICATION =====================
  const socket = io();
  
  // Nach der Socket-Verbindung authentifizieren wir den Benutzer
  socket.on('connect', () => {
    setStatus('ok');
    
    // Authentifiziere den Socket mit der Benutzer-ID
    if (AppState.user && AppState.user.id) {
      socket.emit('auth', AppState.user.id);
      console.log('🔐 Authenticated socket for user:', AppState.user.id);
    }
  });
  
  socket.on('reconnect', () => {
    setStatus('ok');
    
    // Bei Reconnect erneut authentifizieren
    if (AppState.user && AppState.user.id) {
      socket.emit('auth', AppState.user.id);
      console.log('🔐 Re-authenticated socket for user:', AppState.user.id);
    }
  });
  
  socket.on('reconnect_attempt', () => setStatus('warn'));
  socket.on('disconnect', () => setStatus('err'));
  socket.on('connect_error', () => setStatus('err'));
  
  // Listen for settings updates from server
  socket.on('settings:luck_updated', (newLuckSettings) => {
    console.log('🎯 Received updated luck settings:', newLuckSettings);
    SettingsManager.currentSettings.luck = newLuckSettings;
    SettingsManager.updateSettingsUI();
  });
  
  socket.on('settings:general_updated', (newGeneralSettings) => {
    console.log('⚡️ Received updated general settings:', newGeneralSettings);
    SettingsManager.currentSettings.general = newGeneralSettings;
    AppState.settings.autoJoinHost = newGeneralSettings.autoJoinHost;
    SettingsManager.updateSettingsUI();
  });
  
  socket.on('giveaway:status', (status) => {
    console.log('📡 Received giveaway status:', status);
    
    const oldStatus = AppState.giveaway.status;
    
    if (status.state) {
      const newStatus = status.state === 'collect' ? 'ACTIVE' : 
                       status.state === 'locked' ? 'PAUSED' : 'INACTIVE';
      console.log('🎮 Status update from server:', status.state, '→', newStatus, 'Old:', oldStatus);
      
      AppState.giveaway.status = newStatus;
      StateManager.updateStatusDisplay();
      StateManager.updateButtonStates();
      StateManager.updateDurationDisplay();
      StateManager.updateParticipantsHeader();
    }
    
    if (status.keyword) {
      AppState.giveaway.keyword = status.keyword;
      StateManager.updateKeywordDisplay();
    }
    
    // Timer NUR bei echtem Start (mit duration) neu starten
    if (status.duration !== undefined && oldStatus === 'INACTIVE') {
      const durationSeconds = status.duration * 60; // Convert minutes to seconds
      console.log('⏰ Starting new timer with duration:', durationSeconds, 'seconds');
      if (durationSeconds > 0) {
        AppState.giveaway.isTimedMode = true;
        TimerManager.start(durationSeconds);
      } else {
        AppState.giveaway.isTimedMode = false;
        TimerManager.stop();
      }
    }
    
    // Bei Resume ohne duration wird Timer einfach fortgesetzt
    if (oldStatus === 'PAUSED' && newStatus === 'ACTIVE' && !status.duration) {
      console.log('▶️ Resume - Timer continues from:', TimeUtils.secondsToFormat(AppState.giveaway.timeRemaining));
    }
  });
  
  // KORRIGIERTE participant:add Handler
  socket.on('participant:add', (p) => {
    console.log('👥 Participant added:', p);
    AppState.giveaway.entries++;
    StateManager.updateEntriesDisplay();
    StateManager.updateButtonStates();
    
    if (!elements.participantsList) return;
    
    const existingParticipant = elements.participantsList.querySelector(`[data-remove="${p.login}"]`);
    if (existingParticipant) {
      console.log('🎮 Participant already exists, skipping:', p.login);
      return;
    }
    
    elements.participantsList.appendChild(renderParticipant(p));
    updateParticipantCount();
    checkScrollbar();
    
    console.log('✅ Participant added without animation:', p.login);
  });
  
  socket.on('participant:remove', (data) => {
    AppState.giveaway.entries = Math.max(0, AppState.giveaway.entries - 1);
    StateManager.updateEntriesDisplay();
    StateManager.updateButtonStates();
    
    const item = elements.participantsList?.querySelector(`[data-remove="${data.login}"]`)?.closest('li');
    if (item) {
      item.style.opacity = '0';
      item.style.transform = 'translateX(-20px)';
      item.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      setTimeout(() => {
        item.remove();
        updateParticipantCount();
      }, 200);
    }
  });
  
  socket.on('stats:update', (stats) => {
    AppState.giveaway.entries = stats.participants || 0;
    StateManager.updateEntriesDisplay();
    StateManager.updateButtonStates();
  });
  
  socket.on('participants:cleared', () => {
    AppState.giveaway.entries = 0;
    StateManager.updateEntriesDisplay();
    StateManager.updateButtonStates();
    clearParticipantsList();
  });

  socket.on('participant:update', (participant) => {
    console.log('🎮 Participant updated:', participant.login, 'New luck:', participant.luck);
    
    const participantItem = elements.participantsList?.querySelector(`[data-login="${participant.login}"]`);
    if (participantItem) {
      if (participant.profileImageUrl) {
        const avatarImg = participantItem.querySelector('.participant-avatar');
        const fallbackDiv = participantItem.querySelector('.participant-avatar-fallback');
        
        if (avatarImg && fallbackDiv) {
          avatarImg.src = participant.profileImageUrl;
          avatarImg.style.display = 'block';
          fallbackDiv.style.display = 'none';
          
          avatarImg.onerror = () => {
            avatarImg.style.display = 'none';
            fallbackDiv.style.display = 'flex';
          };
        }
      }
      
      const luckDisplay = participantItem.querySelector('.participant-luck');
      if (luckDisplay && participant.luck !== undefined) {
        // ✅ KORRIGIERTER MULTIPLIER TEXT - Zeige immer "X.XXx" Format
        const multiplierText = `${Math.max(1.0, participant.luck).toFixed(2)}x`;
        luckDisplay.textContent = multiplierText;
        
        luckDisplay.style.transition = 'all 0.3s ease';
        luckDisplay.style.transform = 'scale(1.1)';
        luckDisplay.style.color = 'var(--success)';
        
        setTimeout(() => {
          luckDisplay.style.transform = 'scale(1)';
          luckDisplay.style.color = 'var(--accent)';
        }, 300);
        
        console.log(`✅ Updated luck display for ${participant.login}: ${multiplierText}`);
      }
    }
  });

  // Event Listeners
  elements.startBtn?.addEventListener('click', () => {
    if (AppState.giveaway.status === 'PAUSED') {
      EventHandlers.pauseResumeGiveaway();
    } else {
      EventHandlers.startGiveaway();
    }
  });
  
  elements.pauseBtn?.addEventListener('click', EventHandlers.pauseResumeGiveaway);
  elements.pickBtn?.addEventListener('click', EventHandlers.pickWinner);
  elements.resetBtn?.addEventListener('click', EventHandlers.showResetConfirmation);
  
  document.getElementById('confirmReset')?.addEventListener('click', EventHandlers.confirmReset);
  document.getElementById('cancelReset')?.addEventListener('click', EventHandlers.cancelReset);
  
  // Settings Event Listeners
  elements.keywordInput?.addEventListener('blur', (e) => {
    SettingsManager.validateAndUpdateKeyword(e.target.value);
  });
  
  elements.keywordInput?.addEventListener('input', (e) => {
    const validation = Validators.keyword(e.target.value);
    e.target.classList.toggle('valid', validation.valid);
    e.target.classList.toggle('invalid', !validation.valid);
  });
  
  elements.durationMode?.addEventListener('change', () => {
    SettingsManager.toggleDurationField();
  });
  
  // Initialize time input handlers
  TimeInputHandlers.initializeTimeInput();

  // ===================== INITIALIZE USER UND LOAD DATA =====================
  try {
    const r = await fetch('/api/me');
    const me = await r.json();

    if (me && me.loggedIn) {
      // Setze den aktuellen Benutzer im AppState
      AppState.user = me;
      
      if (header.name) {
        const display = me.displayName || me.login || 'Unknown';
        header.name.textContent = display;
        header.name.title = display;
      }
      if (header.avatar && me.avatarUrl) {
        header.avatar.src = me.avatarUrl;
        header.avatar.alt = (me.displayName || me.login || 'avatar') + ' avatar';
      }
      
      // Nach dem Laden des Benutzers authentifiziere den Socket
      if (socket.connected) {
        socket.emit('auth', AppState.user.id);
        console.log('🔐 Authenticated socket for user:', AppState.user.id);
      }
    } else {
      if (header.name) header.name.textContent = 'YourTwitchName';
      if (header.avatar) header.avatar.removeAttribute('src');
    }
  } catch (e) {
    console.error('Failed to load user info:', e);
  }

  // Connect to chat
  try {
    const conn = await fetch('/api/chat/connect', { method: 'POST' });
    if (!conn.ok) throw new Error('connect failed');
    setStatus('ok');
  } catch (e) {
    console.error('Chat connection failed:', e);
    setStatus('err');
  }

  // Initialize Settings and State
 SettingsManager.loadUISettings();
await SettingsManager.loadSettings();
SettingsManager.initializeSliderEvents();
// ✅ KORRIGIERT: Forciere Manual Mode nach dem Laden
if (elements.durationMode) {
  elements.durationMode.value = 'manual';
  AppState.settings.durationMode = 'manual';
}
SettingsManager.toggleDurationField();
StateManager.updateStatus('INACTIVE');
StateManager.updateEntriesDisplay();

  // Load initial data
  try {
    const pRes = await fetch('/api/giveaway/participants');
    const pJson = await pRes.json();
    if (elements.participantsList) {
      elements.participantsList.innerHTML = '';
      (pJson.participants || []).forEach(p => {
        elements.participantsList.appendChild(renderParticipant(p));
      });
    }
    AppState.giveaway.entries = (pJson.participants || []).length;
    StateManager.updateEntriesDisplay();
    StateManager.updateButtonStates();
    
    setTimeout(() => checkScrollbar(), 100);
  } catch (e) {
    console.error('Failed to load participants:', e);
  }

  try {
    const kwRes = await fetch('/api/settings/keyword');
    const kwJson = await kwRes.json();
    if (kwJson.keyword) {
      AppState.giveaway.keyword = kwJson.keyword;
      StateManager.updateKeywordDisplay();
    }
  } catch (e) {
    console.error('Failed to load keyword:', e);
  }

  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      
      document.querySelectorAll('.tab').forEach(t => {
        t.classList.remove('is-active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('is-active');
      tab.setAttribute('aria-selected', 'true');
      
      document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('is-visible');
      });
      document.getElementById(targetTab).classList.add('is-visible');
    });
  });

  // Logout
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    window.location.href = '/logout';
  });

  // HELPER FUNCTIONS
  function showToast(message, type = 'success') {
    UIManager.showToast(message, type);
  }

  function createConfetti() {
    const container = document.getElementById('confettiContainer');
    if (!container) return;

    container.innerHTML = '';
    
    const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#f0932b', '#eb4d4b', '#6c5ce7'];
    
    for (let i = 0; i < 100; i++) {
      const confetti = document.createElement('div');
      confetti.className = 'confetti';
      confetti.style.left = Math.random() * 100 + '%';
      confetti.style.top = '-10px';
      confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      confetti.style.animationDelay = Math.random() * 3 + 's';
      confetti.style.animationDuration = (Math.random() * 3 + 2) + 's';
      container.appendChild(confetti);
    }
    
    setTimeout(() => {
      console.log('🎊 Stopping new confetti creation');
      const confettiElements = container.querySelectorAll('.confetti');
      confettiElements.forEach(element => {
        element.style.animationIterationCount = '1';
      });
      
      setTimeout(() => {
        console.log('🎊 Clearing remaining confetti');
        container.innerHTML = '';
      }, 5000);
    }, 5000);
  }

  document.getElementById('closeWinnerModal')?.addEventListener('click', () => {
    const modal = document.getElementById('winnerModal');
    if (modal) {
      modal.classList.remove('modal--show');
      console.log('🏆 Winner modal manually closed by user');
      
      const confettiContainer = document.getElementById('confettiContainer');
      if (confettiContainer) {
        confettiContainer.innerHTML = '';
      }
      
      if (AppState.winner.timerInterval) {
        clearInterval(AppState.winner.timerInterval);
        AppState.winner.timerInterval = null;
      }
      
      AppState.winner.currentWinner = null;
      AppState.winner.winTime = null;
    }
  });

  function clearParticipantsList() {
    if (elements.participantsList) {
      const participants = Array.from(elements.participantsList.children);
      participants.forEach((participant, index) => {
        setTimeout(() => {
          participant.style.opacity = '0';
          participant.style.transform = 'translateX(-20px)';
          participant.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
          setTimeout(() => participant.remove(), 200);
        }, index * 50);
      });
      
      setTimeout(() => {
        StateManager.updateEntriesDisplay();
        console.log('🗑️ Participants list cleared with animation');
      }, participants.length * 50 + 200);
    }
  }

  elements.participantSearch?.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase().trim();
    const participants = elements.participantsList?.querySelectorAll('li');
    
    participants?.forEach(participant => {
      const name = participant.querySelector('.nick')?.textContent?.toLowerCase() || '';
      const login = participant.querySelector('[data-remove]')?.dataset?.remove?.toLowerCase() || '';
      
      if (searchTerm === '' || name.includes(searchTerm) || login.includes(searchTerm)) {
        participant.classList.remove('hidden');
      } else {
        participant.classList.add('hidden');
      }
    });
  });

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function renderBadges(badges) {
    if (!badges || badges.length === 0) return '';
    
    return badges.map(badge => {
      if (badge.url) {
        const imageUrl = badge.url_2x || badge.url;
        return `<img src="${imageUrl}" alt="${badge.title || badge.name}" title="${badge.title || badge.name}" class="chat-badge" onerror="this.src='${badge.url}'">`;
      }
      return '';
    }).join('');
  }

  // ✅ KORRIGIERTE renderParticipant Funktion mit FIXED Luck Display
  function renderParticipant(p) {
    console.log('🎨 Rendering participant:', p.login, 'Luck:', p.luck);
    const login = p.login || p.name || p.user || '';
    const display = p.displayName || p.display || login;
    const avatar = p.profileImageUrl || p.avatar || p.avatarUrl || '';
    const luck = p.luck || p.mult || 1.0;
    const badges = renderBadges(p.badges);
    
    // ✅ KORRIGIERT: Zeige immer "X.XXx" Format, nie "No Multiplier"
    const multiplierText = `${Math.max(1.0, luck).toFixed(2)}x`;
    
    let avatarHtml;
    if (avatar) {
      avatarHtml = `
        <img src="${avatar}" alt="${display}" class="participant-avatar" 
             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
        <div class="participant-avatar-fallback" style="display:none;">${display.charAt(0).toUpperCase()}</div>
      `;
    } else {
      avatarHtml = `
        <div class="participant-avatar-fallback">${display.charAt(0).toUpperCase()}</div>
      `;
    }
    
    const li = el(`
      <li class="row participant-row" data-login="${login}">
        <div class="who">
          <div class="avatar">
            ${avatarHtml}
          </div>
          <div class="participant-info">
            <div class="participant-name">
              ${badges}
              <span class="nick">${display}</span>
            </div>
            <div class="participant-luck">${multiplierText}</div>
          </div>
        </div>
        <div class="acts">
          <button data-remove="${login}" title="Remove" class="remove-participant-btn">
            <i data-lucide="x"></i>
          </button>
        </div>
      </li>
    `);
    
    lucide.createIcons(li);
    
    // Event Listener für Remove Button
    const removeBtn = li.querySelector('.remove-participant-btn');
    if (removeBtn) {
      removeBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const lg = removeBtn.dataset.remove;
        console.log('🗑️ Attempting to remove participant:', lg);
        
        try {
          const res = await fetch(`/api/giveaway/participants/${encodeURIComponent(lg)}`, { 
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json'
            }
          });
          
          if (res.ok) {
            console.log('✅ Participant removed successfully:', lg);
            li.style.opacity = '0';
            li.style.transform = 'translateX(-20px)';
            li.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
            setTimeout(() => {
              li.remove();
              updateParticipantCount();
            }, 200);
          } else {
            const errorData = await res.json().catch(() => ({}));
            console.error('❌ Failed to remove participant:', res.status, errorData);
            UIManager.showToast(`Failed to remove ${lg}`, 'error');
          }
        } catch (error) {
          console.error('❌ Error removing participant:', error);
          UIManager.showToast(`Error removing ${lg}`, 'error');
        }
      });
    }
    
    return li;
  }

  function updateParticipantCount() {
    const allParticipants = elements.participantsList ? elements.participantsList.children.length : 0;
    
    console.log('📊 Updating participant count:', allParticipants);
    AppState.giveaway.entries = allParticipants;
    StateManager.updateEntriesDisplay();
    
    if (elements.emptyPanel && elements.participantsList) {
      if (allParticipants === 0) {
        console.log('🎮 Showing empty panel');
        elements.emptyPanel.style.display = 'flex';
        elements.participantsList.style.display = 'none';
      } else {
        console.log('🎮 Hiding empty panel, showing participants');
        elements.emptyPanel.style.display = 'none';
        elements.participantsList.style.display = 'flex';
        checkScrollbar();
      }
    }
  }

  function checkScrollbar() {
    if (elements.participantsList) {
      const container = elements.participantsList.parentElement;
      const hasOverflow = elements.participantsList.scrollHeight > elements.participantsList.clientHeight;
      
      if (hasOverflow) {
        elements.participantsList.style.overflowY = 'scroll';
      } else {
        elements.participantsList.style.overflowY = 'auto';
      }
    }
  }

  document.getElementById('sendSim')?.addEventListener('click', async () => {
    const input = document.getElementById('simMsg');
    const text = input?.value?.trim();
    if (!text) return;
    
    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      if (res.ok) {
        input.value = '';
      }
    } catch (e) {
      console.error('Send message failed:', e);
    }
  });

  document.getElementById('simMsg')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('sendSim')?.click();
    }
  });

  // Track angezeigte Nachrichten um Duplikate zu verhindern
  const displayedMessages = new Map();

  socket.on('chat', (ev) => {
    if (!elements.chatList) return;
    
    // Erstelle einen eindeutigen Key für diese Nachricht
    const messageKey = `${ev.user}_${ev.text}_${ev.timestamp}`;
    
    // Prüfe auf Duplikate innerhalb von 2 Sekunden
    if (!ev.isWebsiteMessage) {
      const existing = Array.from(displayedMessages.entries()).find(([key, data]) => {
        return data.user === ev.user && 
               data.text === ev.text && 
               (Date.now() - data.timestamp) < 2000;
      });
      
      if (existing) {
        console.log('💬 Skipping duplicate message:', ev.user, ev.text);
        return;
      }
    }
    
    // Speichere diese Nachricht
    displayedMessages.set(messageKey, {
      user: ev.user,
      text: ev.text,
      timestamp: Date.now()
    });
    
    // Lösche alte Einträge nach 3 Sekunden
    setTimeout(() => {
      displayedMessages.delete(messageKey);
    }, 3000);
    
    const msg = (ev?.message ?? ev?.text ?? '').toString();
    const name = ev?.user || 'User';
    const color = ev?.color || '#a2a2ad';
    const badges = renderBadges(ev.badges || []);
    
    // ✅ KORRIGIERT: Zeige Luck-Multiplier richtig an
    const multiplierText = (ev.luck && ev.luck > 1) ? `${ev.luck.toFixed(2)}x` : '';
    const isParticipant = ev.isParticipant || false;
    
    console.log('💬 Displaying chat message:', {
      user: name,
      badgeCount: (ev.badges || []).length,
      badges: (ev.badges || []).map(b => b.name),
      luck: ev.luck,
      multiplierText
    });
      
    const empty = elements.chatList.querySelector('.empty');
    if (empty) empty.remove();
    
    const row = el(`
      <div class="msg ${isParticipant ? 'participant-msg' : ''}">
        <div class="msg-content">
          <div class="chat-user-info">
            ${badges}
            <span class="user" style="color:${color}">${escapeHtml(name)}:</span>
            ${multiplierText ? `<span class="luck-indicator">${multiplierText}</span>` : ''}
          </div>
          <span class="msg-text">${msg}</span>
        </div>
      </div>
    `);
    elements.chatList.appendChild(row);
    elements.chatList.scrollTop = elements.chatList.scrollHeight;
  });

  socket.on('giveaway:winner', (winner) => {
    showWinnerModal(winner);
    
    setTimeout(() => {
      clearParticipantsList();
    }, 1500);
  });

  socket.on('host:auto_joined', (hostParticipant) => {
    if (!elements.participantsList) return;
    console.log('Host auto-joined:', hostParticipant);
    
    const existingHost = elements.participantsList.querySelector(`[data-remove="${hostParticipant.login}"]`);
    if (!existingHost) {
      elements.participantsList.appendChild(renderParticipant(hostParticipant));
      updateParticipantCount();
      checkScrollbar();
      showToast(`Host ${hostParticipant.displayName} auto-joined the giveaway`);
    }
  });

  socket.on('participant:spam_blocked', (data) => {
    const item = elements.participantsList?.querySelector(`[data-remove="${data.login}"]`)?.closest('li');
    if (item) {
      item.style.opacity = '0';
      item.style.transform = 'translateX(-20px)';
      item.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      setTimeout(() => {
        item.remove();
        updateParticipantCount();
      }, 200);
    }
    
    showToast(`${data.displayName || data.login} was blocked for spamming`, 'error');
  });

  const observer = new MutationObserver(() => {
    lucide.createIcons();
  });
  
  if (elements.participantsList) {
    observer.observe(elements.participantsList, { childList: true });
  }
  if (elements.chatList) {
    observer.observe(elements.chatList, { childList: true });
  }

  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) {
      const modal = document.getElementById('winnerModal');
      if (modal && modal.classList.contains('modal--show')) {
        modal.classList.remove('modal--show');
        
        const confettiContainer = document.getElementById('confettiContainer');
        if (confettiContainer) {
          confettiContainer.innerHTML = '';
        }
        
        if (AppState.winner.timerInterval) {
          clearInterval(AppState.winner.timerInterval);
          AppState.winner.timerInterval = null;
        }
        
        AppState.winner.currentWinner = null;
        AppState.winner.winTime = null;
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('winnerModal');
      if (modal && modal.classList.contains('modal--show')) {
        modal.classList.remove('modal--show');
        console.log('🏆 Winner modal closed by ESC key');
        
        const confettiContainer = document.getElementById('confettiContainer');
        if (confettiContainer) {
          confettiContainer.innerHTML = '';
        }
        
        if (AppState.winner.timerInterval) {
          clearInterval(AppState.winner.timerInterval);
          AppState.winner.timerInterval = null;
        }
        
        AppState.winner.currentWinner = null;
        AppState.winner.winTime = null;
      }
      UIManager.hideResetConfirmation();
    }
    
    if (e.key === ' ' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
      e.preventDefault();
      if (AppState.giveaway.status === 'INACTIVE') {
        elements.startBtn?.click();
      } else if (AppState.giveaway.status === 'ACTIVE') {
        elements.pauseBtn?.click();
      }
    }
  });

  console.log('🎬 Enhanced ZinxyBot Dashboard fully initialized with MM:SS time format!');
  console.log('🔐 User authentication and session isolation active');
  console.log('⏰ Timer-end bug fixed - participants will be correctly picked');
  console.log('🕐 MM:SS time format implemented with 10-second increments');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
