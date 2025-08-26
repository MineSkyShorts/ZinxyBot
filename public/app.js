// ---- Enhanced Dashboard Bootstrapping - KORRIGIERT MIT TIMER-FIX UND MM:SS FORMAT ----
// DATEI: app.js - Korrigiert für Timer-Ende-Problem und MM:SS Zeitformat

document.addEventListener('DOMContentLoaded', () => { 
  // Initialize Lucide icons first
  lucide.createIcons();
  
  // Then boot the application
  void boot(); 
});

// ===================== ADMIN SYSTEM =====================
const AdminSystem = {
  isAdmin: false,

  async init() {
    console.group('🔐 Admin System');
    console.log('Initialisiere Admin System...');
    
    // Check if current user has admin privileges (based on Twitch User ID)
    await this.checkStatus();
  },

  async checkStatus() {
    try {
      const response = await fetch('/admin/status');
      const data = await response.json();
      
      if (data.isAdmin) {
        this.setAdminStatus(true, data.username, data.userId);
      } else {
        this.setAdminStatus(false, null, null);
      }
    } catch (error) {
      console.error('Fehler beim Überprüfen des Admin Status:', error);
      console.groupEnd();
    }
  },

  setAdminStatus(isAdmin, username, userId) {
    this.isAdmin = isAdmin;
    
    // Update UI
    const body = document.body;
    const adminCrown = document.getElementById('adminCrown');
    
    if (isAdmin) {
      body.classList.add('admin-logged-in');
      
      // Update crown tooltip with username
      if (adminCrown) {
        adminCrown.title = "Admin";
      }
      
      console.log(`Admin Berechtigung aktiv für ${username} (ID: ${userId})`);
      console.groupEnd();
      
      // Show admin toast notification
      setTimeout(() => {
        if (typeof UIManager !== 'undefined' && UIManager.showToast) {
          UIManager.showToast(`👑 Admin privileges activated for ${username}`, 'success');
        }
      }, 1500); // Delay to let UI load first
      
    } else {
      body.classList.remove('admin-logged-in');
      console.log('Keine Admin Berechtigung');
      console.groupEnd();
    }
  }
};

// Function to load user badges and luck multiplier
// This function will be called after AppState is initialized
async function loadUserBadges(user, appState) {
  try {
    console.log('🏷️ Lade Badges für Benutzer:', user.login);
    
    // Versuche Badges über eine API-Route zu laden
    const response = await fetch(`/api/user/${user.id}/badges`);
    if (response.ok) {
      const badgeData = await response.json();
      if (badgeData.badges) {
        appState.userBadges = badgeData.badges;
        appState.userLuck = badgeData.luck || 1.0;
        console.log('✅ Badges geladen:', appState.userBadges.length, 'Badges, Luck:', appState.userLuck);
        return;
      }
    }
    
    // Fallback: Anfrage über Socket um Badge-Informationen zu erhalten
    console.log('⚠️ API-Route nicht verfügbar, frage Badges über Socket an...');
    if (typeof socket !== 'undefined' && socket && socket.connected) {
      socket.emit('request:user-badges', { userId: user.id });
      
      // Zusätzlicher Fallback: Sende eine unsichtbare Nachricht um Badge-Trigger auszulösen
      setTimeout(() => {
        if (appState.userBadges.length === 0) {
          console.log('🔄 Sende Badge-Trigger-Nachricht...');
          // Diese Nachricht wird nicht im Chat angezeigt, aber Badge-Informationen triggern
          socket.emit('chat:get-badges', { userId: user.id, trigger: true });
        }
      }, 1000);
    }
  } catch (error) {
    console.warn('Fehler beim Laden der Badges:', error);
  }
}

async function boot() {
  // Enhanced State Management System
  const AppState = {
    user: null, // Aktueller Benutzer
    userBadges: [], // Cache für Badges des aktuellen Benutzers
    userLuck: 1.0, // Cache für Luck-Multiplier des aktuellen Benutzers
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
    sortBtn: document.getElementById('sortBtn'),
    sortMenu: document.getElementById('sortMenu'),
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
      
      console.group('⏰ Timer');
      console.log(`Timer gestartet für ${durationSeconds} Sekunden (${TimeUtils.secondsToFormat(durationSeconds)})`);
      
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
      console.log('Timer pausiert bei:', TimeUtils.secondsToFormat(AppState.giveaway.timeRemaining));
    },
    
    resume() {
      console.log('Timer fortgesetzt bei:', TimeUtils.secondsToFormat(AppState.giveaway.timeRemaining));
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
      console.log('Timer beendet - Stoppe Timer und prüfe Teilnehmer');
      this.stop(); // Stoppe Timer sofort
      
      // Prüfe aktuellen Status
      if (AppState.giveaway.status !== 'ACTIVE') {
        console.warn('Timer beendet aber Giveaway nicht aktiv');
        return;
      }
      
      console.log(`Timer beendet mit ${AppState.giveaway.entries} Teilnehmern`);
      console.groupEnd();
      
      if (AppState.giveaway.entries > 0) {
        console.log('Automatische Gewinner-Auswahl durch Timer-Ende');
        
        // Gehe direkt zur Gewinner-Auswahl ohne PAUSED Status
        try {
          // Verwende die Server API für korrekten Winner Pick
          await EventHandlers.pickWinner();
        } catch (error) {
          console.error('Fehler bei automatischer Gewinner-Auswahl:', error);
          UIManager.showToast('Failed to pick winner automatically', 'error');
          StateManager.updateStatus('INACTIVE');
        }
      } else {
        console.log('Timer beendet ohne Teilnehmer');
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
      
    console.group('🎮 Status');
    console.log(`Status geändert: ${oldStatus} → ${newStatus}`);
    console.groupEnd();
      
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
          elements.startBtn.textContent = 'Giveaway Active';
          const icon = document.createElement('i');
          icon.setAttribute('data-lucide', 'square');
          elements.startBtn.prepend(icon);
          elements.startBtn.disabled = true;
          
          elements.pauseBtn.className = 'btn btn--orange';
          elements.pauseBtn.textContent = 'Pause';
          const pauseIcon = document.createElement('i');
          pauseIcon.setAttribute('data-lucide', 'pause');
          elements.pauseBtn.prepend(pauseIcon);
          elements.pauseBtn.disabled = false;
          
          elements.pickBtn.disabled = false;
          elements.resetBtn.disabled = false;
          break;
          
        case 'PAUSED':
          elements.startBtn.className = 'btn btn--primary';
          elements.startBtn.textContent = 'Resume Giveaway';
          const resumeIcon = document.createElement('i');
          resumeIcon.setAttribute('data-lucide', 'play');
          elements.startBtn.prepend(resumeIcon);
          elements.startBtn.disabled = false;
          
          elements.pauseBtn.className = 'btn btn--gray';
          elements.pauseBtn.textContent = 'Pause';
          const pauseIcon2 = document.createElement('i');
          pauseIcon2.setAttribute('data-lucide', 'pause');
          elements.pauseBtn.prepend(pauseIcon2);
          elements.pauseBtn.disabled = true;
          
          elements.pickBtn.className = 'btn btn--success';
          elements.pickBtn.disabled = false;
          elements.resetBtn.disabled = false;
          break;
          
        default:
          elements.startBtn.className = 'btn btn--primary';
          elements.startBtn.textContent = 'Start Giveaway';
          const startIcon = document.createElement('i');
          startIcon.setAttribute('data-lucide', 'play');
          elements.startBtn.prepend(startIcon);
          elements.startBtn.disabled = AppState.ui.isStarting;
          
          elements.pauseBtn.className = 'btn btn--warn';
          elements.pauseBtn.textContent = 'Pause';
          const pauseIcon3 = document.createElement('i');
          pauseIcon3.setAttribute('data-lucide', 'pause');
          elements.pauseBtn.prepend(pauseIcon3);
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
        elements.participantsHeader.innerHTML = `<i data-lucide="users" aria-hidden="true"></i>${baseText} ${countElement}${keywordInfo}`;
      } else {
        elements.participantsHeader.innerHTML = `<i data-lucide="users" aria-hidden="true"></i>${baseText} ${countElement}`;
      }
      
      lucide.createIcons(elements.participantsHeader);
      elements.participantCount = document.getElementById('participantCount');
    },
    
    updateEntriesDisplay() {
      const count = String(AppState.giveaway.entries);
      
      if (elements.entriesEl) {
        elements.entriesEl.textContent = count;
        // Only add animation if count > 0 to prevent green animation on 0 entries
        if (AppState.giveaway.entries > 0) {
          elements.entriesEl.classList.add('entries-updating');
          setTimeout(() => elements.entriesEl.classList.remove('entries-updating'), 500);
        }
      }
      if (elements.participantCount) elements.participantCount.textContent = count;
    },
    
    updateKeywordDisplay() {
      if (elements.kwTag) elements.kwTag.textContent = AppState.giveaway.keyword.replace(/\n/g, ' ');
      if (elements.keywordInput) elements.keywordInput.value = AppState.giveaway.keyword;
    }
  };

  // Enhanced UI Management
  const UIManager = {
    // Utility function to enforce toast limit
    enforceToastLimit() {
      if (!elements.toastContainer) return;
      
      const existingToasts = elements.toastContainer.querySelectorAll('.toast');
      const maxToasts = 3;
      
      if (existingToasts.length >= maxToasts) {
        // Remove oldest toasts to make room
        const toastsToRemove = existingToasts.length - maxToasts + 1;
        for (let i = 0; i < toastsToRemove; i++) {
          const oldestToast = existingToasts[i];
          if (oldestToast) {
            oldestToast.classList.remove('toast--show');
            setTimeout(() => {
              if (oldestToast.parentNode) {
                oldestToast.remove();
              }
            }, 300);
          }
        }
      }
    },
showResetConfirmation() {
  if (!elements.toastContainer) return;
  
  // Check if a reset toast already exists
  const existingResetToast = document.getElementById('activeResetToast');
  if (existingResetToast) {
    console.log('Reset-Toast bereits aktiv - ignoriere neue Anfrage');
    return;
  }
  
  // Remove all other toasts to make room for reset toast
  const existingToasts = elements.toastContainer.querySelectorAll('.toast');
  existingToasts.forEach(toast => {
    toast.classList.remove('toast--show');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 300);
  });
  
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
  
  // Auto-hide after 10 seconds
  setTimeout(() => {
    const stillExists = document.getElementById('activeResetToast');
    if (stillExists) {
      console.log('Reset-Toast automatisch ausgeblendet nach 10 Sekunden');
      this.hideResetConfirmation();
      EventHandlers.cancelReset();
    }
  }, 10000);
  
  console.group('🔄 Reset');
  console.log('Reset Bestätigung angezeigt');
},

hideResetConfirmation() {
  const resetToast = document.getElementById('activeResetToast');
  if (resetToast) {
    resetToast.classList.remove('toast--show');
    setTimeout(() => resetToast.remove(), 300);
    console.log('Reset Bestätigung versteckt');
    console.groupEnd();
  }
},
    
    showToast(message, type = 'success') {
      if (!elements.toastContainer) return;

      // Enforce toast limit before showing new toast
      this.enforceToastLimit();

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
        setTimeout(() => {
          if (toast.parentNode) {
            toast.remove();
          }
        }, 300);
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
        console.group('⚙️ Einstellungen');
        console.log('Lade Einstellungen vom Server...');
        
        // Lade Luck Settings
        const luckResponse = await fetch('/api/settings/luck');
        if (luckResponse.ok) {
          this.currentSettings.luck = await luckResponse.json();
          console.log('Glück-Einstellungen geladen:', this.currentSettings.luck);
        }

        // Lade General Settings
        const generalResponse = await fetch('/api/settings/general');
        if (generalResponse.ok) {
          this.currentSettings.general = await generalResponse.json();
          console.log('Allgemeine Einstellungen geladen:', this.currentSettings.general);
        }

        this.updateSettingsUI();
      } catch (error) {
        console.error('Fehler beim Laden der Einstellungen:', error);
        console.groupEnd();
      }
    },

    updateSettingsUI() {
      console.log('Aktualisiere Einstellungs-UI...');
      
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
          console.log(`Bit-Regler aktualisiert für ${minValue}: ${setting.mult}x`);
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
          console.log(`Sub-Regler aktualisiert für ${minValue}: ${setting.mult}x`);
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
        
        console.log('Speichere alle Einstellungen auf Server...', this.currentSettings);
        
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
            saveButton.classList.remove('loading', 'btn--primary');
            saveButton.classList.add('btn--success');
            if (saveText) saveText.textContent = 'Saved!';
            if (saveIcon) saveIcon.setAttribute('data-lucide', 'check');
            lucide.createIcons(saveButton);
          }
          
          UIManager.showToast('Settings saved and applied successfully!', 'success');
          console.log('Alle Einstellungen gespeichert und angewendet:', this.currentSettings);
          console.groupEnd();
          
          AppState.settings.autoJoinHost = this.currentSettings.general.autoJoinHost;
          
          setTimeout(() => {
            if (saveButton) {
              saveButton.disabled = false;
              // Keep the button green (success state)
              if (saveText) saveText.textContent = 'Save Settings';
              if (saveIcon) saveIcon.setAttribute('data-lucide', 'save');
              lucide.createIcons(saveButton);
            }
          }, 2000);
          
        } else {
          throw new Error('Failed to save settings');
        }
      } catch (error) {
        console.error('Fehler beim Speichern der Einstellungen:', error);
        console.groupEnd();
        UIManager.showToast('Failed to save settings', 'error');
        
        if (saveButton) {
          saveButton.disabled = false;
          saveButton.classList.remove('loading');
          // Keep original button styling (should be btn--success)
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
        const userInfo = await response.json();
        
        // Load follower information separately
        try {
          const followResponse = await fetch(`/api/user-follow/${userId}`);
          if (followResponse.ok) {
            const followData = await followResponse.json();
            userInfo.followInfo = followData;
          } else {
            userInfo.followInfo = null;
          }
        } catch (followError) {
          console.warn('Fehler beim Laden der Follower-Info:', followError);
          userInfo.followInfo = null;
        }
        
        return userInfo;
      }
    } catch (e) {
      console.error('Fehler beim Laden der Benutzer-Info:', e);
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
  // Utility function for API calls with retry logic
  async function makeAuthenticatedRequest(url, options = {}, maxRetries = 2) {
    let retryCount = 0;
    
    do {
      const response = await fetch(url, options);
      
      if (response.status === 401) {
        console.warn(`Authentifizierungsfehler bei ${url} (Versuch ${retryCount + 1}/${maxRetries + 1})`);
        
        if (retryCount < maxRetries) {
          // Re-authenticate user before retry
          if (AppState.user && AppState.user.id) {
            localSafeSocketEmit('auth', AppState.user.id);
            console.log('Socket neu authentifiziert für Retry...');
          }
          
          // Wait a bit before retry
          await new Promise(resolve => setTimeout(resolve, 1000));
          retryCount++;
          continue;
        } else {
          throw new Error('Authentication failed after multiple attempts. Please refresh the page.');
        }
      }
      
      return response; // Return the response for further processing
      
    } while (retryCount <= maxRetries);
  }

  const EventHandlers = {
    async startGiveaway() {
  if (AppState.ui.isStarting || AppState.giveaway.status === 'ACTIVE') {
    console.warn('Start bereits in Bearbeitung oder Giveaway aktiv');
    return;
  }
  
  // ✅ KORRIGIERT: Warte bis Settings vollständig geladen sind
  if (!SettingsManager.currentSettings || !SettingsManager.currentSettings.general) {
    console.warn('Einstellungen noch nicht geladen, warte...');
    UIManager.showToast('Please wait for settings to load', 'error');
    return;
  }
  
  AppState.ui.isStarting = true;
  StateManager.updateButtonStates();
  
  try {
    const settings = SettingsManager.getStartSettings();
        console.group('🎬 Giveaway Start');
        console.log('Starte Giveaway mit Einstellungen:', settings);
        
// ✅ KORRIGIERT: Verwende aktuelle Settings für autoJoinHost
const currentAutoJoin = SettingsManager.currentSettings.general.autoJoinHost || false;

// Try to start giveaway with retry logic for authentication issues
const res = await makeAuthenticatedRequest('/api/giveaway/start', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    keyword: settings.keyword,
    duration: Math.floor(settings.durationSeconds / 60), // Convert to minutes for server
    subsOnly: settings.subsOnly,
    autoJoinHost: currentAutoJoin
  })
});

if (!res.ok) {
  const errorData = await res.json().catch(() => ({}));
  throw new Error(`Server error (${res.status}): ${errorData.error || 'Unknown error'}`);
}
        
        if (res.ok) {
          AppState.giveaway.keyword = settings.keyword;
          AppState.giveaway.duration = settings.durationSeconds;
          AppState.giveaway.subsOnly = settings.subsOnly;
          AppState.giveaway.autoJoinHost = settings.autoJoinHost;
          AppState.giveaway.isTimedMode = settings.isTimedMode;
          
          StateManager.updateStatus('ACTIVE', { durationSeconds: settings.durationSeconds });
          UIManager.showToast('Giveaway started successfully!');
        }
      } catch (e) {
        console.error('Fehler beim Starten:', e);
        console.groupEnd();
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
          console.warn('Pause/Fortsetzen nicht möglich - Giveaway nicht aktiv');
          return;
        }
        
        console.group(`🎮 ${actionName}`);
        console.log(`Versuche Giveaway zu ${actionName}... Status:`, AppState.giveaway.status);
        
        const res = await makeAuthenticatedRequest(endpoint, { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (res.ok) {
          const data = await res.json();
          console.log(`${actionName} erfolgreich:`, data);
          console.groupEnd();
          UIManager.showToast(`Giveaway ${actionName}d successfully!`);
        } else {
          const errorData = await res.json().catch(() => ({}));
          console.error(`${actionName} fehlgeschlagen:`, res.status, errorData);
          console.groupEnd();
          throw new Error(`Server responded with status ${res.status}: ${errorData.error || 'Unknown error'}`);
        }
      } catch (e) {
        console.error(`${AppState.giveaway.status === 'ACTIVE' ? 'Pause' : 'Fortsetzen'} fehlgeschlagen:`, e);
        console.groupEnd();
        UIManager.showToast(`Failed to ${AppState.giveaway.status === 'ACTIVE' ? 'pause' : 'resume'} giveaway: ${e.message}`, 'error');
      }
    },
    
    async pickWinner() {
      if (AppState.ui.isPicking) {
        console.warn('Gewinner-Auswahl bereits in Bearbeitung');
        return;
      }
      
      if (AppState.giveaway.entries === 0) {
        UIManager.showToast('No participants to pick from!', 'error');
        return;
      }
      
      AppState.ui.isPicking = true;
      StateManager.updateButtonStates();
      
      try {
        console.group('🏆 Gewinner-Auswahl');
        console.log(`Wähle Gewinner aus ${AppState.giveaway.entries} Teilnehmern`);
        
        const res = await makeAuthenticatedRequest('/api/giveaway/end', { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(`Server error: ${res.status} - ${errorData.error || 'Unknown error'}`);
        }
        
        const data = await res.json();
        
        if (data.winner) {
          console.log('Gewinner ausgewählt:', data.winner.displayName || data.winner.login);
          console.groupEnd();
          StateManager.updateStatus('INACTIVE');
          UIManager.showToast(`Winner selected: ${data.winner.displayName || data.winner.login}!`, 'success');
        } else if (data.error === 'no_participants') {
          console.log('Keine Teilnehmer Fehler vom Server');
          console.groupEnd();
          UIManager.showToast('No participants to pick from!', 'error');
          StateManager.updateStatus('INACTIVE');
        } else {
          throw new Error('Unexpected response from server');
        }
      } catch (e) {
        console.error('Gewinner-Auswahl fehlgeschlagen:', e);
        console.groupEnd();
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
        // If giveaway is active/paused, only clear participants (keep giveaway running)
        if (AppState.giveaway.status === 'ACTIVE' || AppState.giveaway.status === 'PAUSED') {
          const res = await makeAuthenticatedRequest('/api/giveaway/participants/clear', { method: 'POST' });
          if (res.ok) {
            UIManager.showToast('Participants cleared - giveaway continues', 'success');
          } else {
            UIManager.showToast('Failed to clear participants', 'error');
          }
        } else {
          // If giveaway is inactive, do full reset (stop everything)
          TimerManager.stop();
          
          const res = await makeAuthenticatedRequest('/api/giveaway/stop', { method: 'POST' });
          if (res.ok) {
            StateManager.updateStatus('INACTIVE');
            
            // Beim kompletten Reset entferne alle Konfetti-Animationen
            const confettiContainer = document.getElementById('confettiContainer');
            if (confettiContainer) {
              confettiContainer.innerHTML = '';
            }
            
            UIManager.showToast('Giveaway reset successfully');
            console.log('Giveaway zurückgesetzt');
          } else {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(`Server error (${res.status}): ${errorData.error || 'Unknown error'}`);
          }
        }
      } catch (e) {
        console.error('Reset fehlgeschlagen:', e);
        console.groupEnd();
        UIManager.showToast('Failed to reset giveaway', 'error');
      } finally {
        AppState.ui.isResetting = false;
      }
    },
    
    cancelReset() {
      UIManager.hideResetConfirmation();
      console.log('Reset abgebrochen');
      console.groupEnd();
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
        
        // Remove validation classes when losing focus
        e.target.classList.remove('valid', 'invalid');
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
      existingModal.classList.remove('modal--show');
    }
    
    // Konfetti wird nicht gelöscht - lasse laufende Animationen weiterlaufen
    
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
      console.log('Setze Gewinner Avatar:', winner.profileImageUrl);
      
      winnerAvatar.onerror = () => {
        console.log('Avatar laden fehlgeschlagen, verwende Fallback');
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
      console.log('Kein Profilbild für Gewinner, verwende Fallback');
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
          // Account creation date
          const createdAtEl = document.getElementById('winnerCreatedAt');
          if (createdAtEl) {
            if (userInfo.createdAt) {
              createdAtEl.textContent = formatDate(userInfo.createdAt);
            } else {
              createdAtEl.textContent = 'Unknown';
            }
          }
          
          // Follower information
          const followStatusEl = document.getElementById('winnerFollowStatus');
          
          if (followStatusEl) {
            if (userInfo.followInfo && userInfo.followInfo.isFollowing) {
              followStatusEl.textContent = '✓ Following';
              followStatusEl.style.color = 'var(--success)';
            } else if (userInfo.followInfo && userInfo.followInfo.isFollowing === false) {
              followStatusEl.textContent = '✗ Not following';
              followStatusEl.style.color = '#ff4444';
            } else {
              followStatusEl.textContent = 'Unable to load';
              followStatusEl.style.color = 'var(--text-muted)';
            }
          }
        } else {
          const createdAtEl = document.getElementById('winnerCreatedAt');
          const followStatusEl = document.getElementById('winnerFollowStatus');
          
          if (createdAtEl) createdAtEl.textContent = 'Unable to load';
          if (followStatusEl) {
            followStatusEl.textContent = 'Unable to load';
            followStatusEl.style.color = 'var(--text-muted)';
          }
        }
      } catch (e) {
        console.error('Fehler beim Laden der Benutzer-Info:', e);
        const createdAtEl = document.getElementById('winnerCreatedAt');
        const followStatusEl = document.getElementById('winnerFollowStatus');
        
        if (createdAtEl) createdAtEl.textContent = 'Error loading data';
        if (followStatusEl) {
          followStatusEl.textContent = 'Error loading data';
          followStatusEl.style.color = 'var(--text-muted)';
        }
      }
    } else {
      // No userId available - set default values to clear "Loading..." text
      const createdAtEl = document.getElementById('winnerCreatedAt');
      const followStatusEl = document.getElementById('winnerFollowStatus');
      
      if (createdAtEl) createdAtEl.textContent = 'Not available';
      if (followStatusEl) {
        followStatusEl.textContent = 'Not available';
        followStatusEl.style.color = 'var(--text-muted)';
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
    
    console.group('🏆 Gewinner Modal');
    console.log('Gewinner Modal geöffnet für:', winner.displayName || winner.login);
    console.groupEnd();
  }

  // Statuspoint helper
  function setStatus(cls) {
    if (!header.status) return;
    header.status.className = `status ${cls || ''}`;
  }

  // ===================== TWITCH-STYLE CHAT WRAPPING UTILITY =====================
  function checkMessageWrap(messageRow) {
    const msgContent = messageRow.querySelector('.msg-content');
    const msgText = messageRow.querySelector('.msg-text');
    
    if (!msgContent || !msgText) return;
    
    // Get the container width
    const msgElement = messageRow.querySelector('.msg');
    if (!msgElement) return;
    
    // Ensure we start with inline layout
    msgContent.classList.remove('wrap-text');
    
    // Allow layout to settle before measuring
    requestAnimationFrame(() => {
      try {
        // Get available width (minus padding)
        const availableWidth = msgElement.clientWidth - 20;
        
        // Measure the total content width when inline
        const totalWidth = msgContent.scrollWidth;
        
        // If content overflows, wrap to new line like Twitch
        if (totalWidth > availableWidth) {
          msgContent.classList.add('wrap-text');
        }
      } catch (error) {
        console.debug('Message wrap check failed:', error);
      }
    });
  }

  // Handle window resize to re-evaluate message wrapping
  window.addEventListener('resize', () => {
    const messages = document.querySelectorAll('.chat .msg');
    messages.forEach(msg => checkMessageWrap(msg));
  });

  // ===================== EMOTE ENHANCEMENT FUNCTIONS =====================
  function renderEmotesInText(textElement, emotes) {
    console.log(`🔍 renderEmotesInText called with:`, { emotes: emotes, textContent: textElement.textContent });
    
    if (!emotes || emotes.length === 0) {
      console.log(`⚠️ No emotes to render`);
      return;
    }
    
    let html = textElement.textContent;
    console.log(`📝 Original text: "${html}"`);
    
    // Sort emotes by position (descending) to avoid position shifts
    const sortedEmotes = emotes.sort((a, b) => b.start - a.start);
    console.log(`🎯 Sorted emotes:`, sortedEmotes);
    
    // Replace text with emote images
    sortedEmotes.forEach(emote => {
      const emoteName = emote.name;
      
      // Use Unicode-aware patterns for better foreign emote support
      const patterns = [
        new RegExp(`(?<=^|\\s)${escapeRegExp(emoteName)}(?=\\s|$)`, 'gu'), // Space boundaries (Unicode aware)
        new RegExp(`\\b${escapeRegExp(emoteName)}\\b`, 'g'), // Traditional word boundaries
        new RegExp(escapeRegExp(emoteName), 'g') // Fallback: exact match
      ];
      
      console.log(`🔎 Looking for "${emoteName}" in text`);
      
      let foundMatch = false;
      for (const regex of patterns) {
        if (regex.test(html)) {
          console.log(`✅ Found "${emoteName}" - replacing with image`);
          
          // Add animated class for animated emotes
          const animatedClass = emote.animated ? ' emote-animated' : '';
          const replacement = `<img src="${escapeHtml(emote.url)}" alt="${escapeHtml(emoteName)}" class="chat-emote emote-${escapeHtml(emote.provider)}${animatedClass}" title="${escapeHtml(emoteName)} (${escapeHtml(emote.provider.toUpperCase())})" loading="lazy" onerror="this.style.display='none'">`;
          
          // Reset regex for replace
          regex.lastIndex = 0;
          html = html.replace(regex, replacement);
          foundMatch = true;
          break;
        }
      }
      
      if (!foundMatch) {
        console.log(`❌ "${emoteName}" not found in text`);
      }
    });
    
    console.log(`🎭 Final HTML: "${html}"`);
    textElement.innerHTML = html;
    
    console.log(`✅ Rendered ${emotes.length} emotes in message`);
  }
  
  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  
  function escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function enhanceEmotesInMessage(messageElement, emotes = []) {
    const textElement = messageElement.querySelector('.msg-text');
    if (!textElement) return;
    
    // Check if HTML emotes are already rendered properly
    const htmlContent = textElement.innerHTML;
    if (htmlContent.includes('<img') && htmlContent.includes('chat-emote')) {
      console.log(`🔄 Found HTML emotes already rendered, keeping them as-is`);
      // Emotes are already properly rendered as HTML, just ensure error handling
      const emoteImages = textElement.querySelectorAll('img.chat-emote');
      emoteImages.forEach(img => {
        img.addEventListener('error', () => {
          console.warn('Emote failed to load:', img.src);
          img.style.display = 'none';
        });
      });
      return;
    }
    
    // Clean up any existing IMG tags that might be showing as text
    let textContent = textElement.textContent || textElement.innerText || '';
    textContent = textContent.replace(/<img[^>]*>/g, '');
    
    // If we have emote data from server, use that
    if (emotes && emotes.length > 0) {
      console.log(`🎭 Using emote data from server:`, emotes);
      textElement.textContent = textContent; // Set clean text first
      renderEmotesInText(textElement, emotes);
      return;
    }
    
    // Set clean text if no emotes
    textElement.textContent = textContent;
    
    // Enhanced handling for any existing emote images
    const emoteImages = messageElement.querySelectorAll('img.chat-emote');
    
    emoteImages.forEach(img => {
      // No click handlers - emotes are just decorative
      
      // Improve loading and error handling
      img.addEventListener('load', () => {
        img.classList.add('emote-loaded');
      });
      
      img.addEventListener('error', () => {
        img.classList.add('emote-error');
      });
      
      // Add better accessibility
      if (!img.getAttribute('tabindex')) {
        img.setAttribute('tabindex', '0');
      }
      
      // Enhanced tooltips based on provider
      if (img.title) {
        const provider = img.className.includes('emote-bttv') ? 'BTTV' :
                        img.className.includes('emote-ffz') ? 'FFZ' :
                        img.className.includes('emote-7tv') ? '7TV' : 'Twitch';
        
        const emoteName = img.alt || 'Unknown';
        img.title = `${emoteName} (${provider})`;
      }
    });
    
    // Text emotes are just decorative - no interactions needed
  }
  
  // Removed emote inspection functions
  
  function showTextEmoteDetails(originalText, emoji) {
    UIManager.showToast(`${originalText} → ${emoji}`, 'success');
  }
  
  function showEmotePopup(name, provider, url) {
    // Remove existing popup
    const existingPopup = document.getElementById('emotePopup');
    if (existingPopup) existingPopup.remove();
    
    const popup = document.createElement('div');
    popup.id = 'emotePopup';
    popup.className = 'emote-popup';
    popup.innerHTML = `
      <div class="emote-popup-content">
        <img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" class="emote-popup-image">
        <div class="emote-popup-info">
          <div class="emote-name">${escapeHtml(name)}</div>
          <div class="emote-provider">${escapeHtml(provider)}</div>
        </div>
        <button class="emote-popup-close">×</button>
      </div>
    `;
    
    document.body.appendChild(popup);
    
    // Add secure event listener for close button
    const closeBtn = popup.querySelector('.emote-popup-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => popup.remove());
    }
    
    // Position popup at cursor (simplified)
    popup.style.position = 'fixed';
    popup.style.top = '50%';
    popup.style.left = '50%';
    popup.style.transform = 'translate(-50%, -50%)';
    popup.style.zIndex = '10000';
    
    // Auto-close after 3 seconds
    setTimeout(() => {
      if (popup.parentElement) popup.remove();
    }, 3000);
  }

  // ===================== INITIALIZE SOCKET.IO MIT AUTHENTICATION =====================
  const socket = io();
  
  // Make socket available globally for helper functions
  window.socket = socket;
  
  // Local helper function for safe socket operations within boot scope
  function localSafeSocketEmit(eventName, data, callback) {
    if (typeof socket !== 'undefined' && socket && socket.connected) {
      socket.emit(eventName, data, callback);
      return true;
    } else {
      console.warn('Socket nicht verfügbar oder nicht verbunden. Event:', eventName);
      return false;
    }
  }
  
  // Nach der Socket-Verbindung authentifizieren wir den Benutzer
  socket.on('connect', () => {
    setStatus('ok');
    
    // Authentifiziere den Socket mit der Benutzer-ID
    if (AppState.user && AppState.user.id) {
      localSafeSocketEmit('auth', AppState.user.id);
      console.group('🔌 Socket');
      console.log('Socket authentifiziert für Benutzer:', AppState.user.id);
    }
  });
  
  socket.on('reconnect', () => {
    setStatus('ok');
    
    // Bei Reconnect erneut authentifizieren
    if (AppState.user && AppState.user.id) {
      localSafeSocketEmit('auth', AppState.user.id);
      console.log('Socket erneut authentifiziert für Benutzer:', AppState.user.id);
    }
  });
  
  socket.on('reconnect_attempt', () => setStatus('warn'));
  socket.on('disconnect', () => setStatus('err'));
  socket.on('connect_error', () => setStatus('err'));
  
  // Listen for settings updates from server
  socket.on('settings:luck_updated', (newLuckSettings) => {
    console.log('Glück-Einstellungen erhalten:', newLuckSettings);
    SettingsManager.currentSettings.luck = newLuckSettings;
    SettingsManager.updateSettingsUI();
  });
  
  socket.on('settings:general_updated', (newGeneralSettings) => {
    console.log('Allgemeine Einstellungen erhalten:', newGeneralSettings);
    SettingsManager.currentSettings.general = newGeneralSettings;
    AppState.settings.autoJoinHost = newGeneralSettings.autoJoinHost;
    SettingsManager.updateSettingsUI();
  });
  
  socket.on('giveaway:status', (status) => {
    console.log('Giveaway Status erhalten:', status);
    
    const oldStatus = AppState.giveaway.status;
    
    if (status.state) {
      const newStatus = status.state === 'collect' ? 'ACTIVE' : 
                       status.state === 'locked' ? 'PAUSED' : 'INACTIVE';
      console.log('Status-Update vom Server:', status.state, '→', newStatus, 'Alt:', oldStatus);
      
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
      console.log('Starte neuen Timer mit Dauer:', durationSeconds, 'Sekunden');
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
      console.log('Fortsetzen - Timer läuft weiter von:', TimeUtils.secondsToFormat(AppState.giveaway.timeRemaining));
    }
  });
  
  // KORRIGIERTE participant:add Handler
  // Removed duplicate - handled in later socket.on('participant:add')
  
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

  // Popup system handler
  socket.on('admin:popup', (data) => {
    console.log('🚀 Admin popup flood started for', data.duration / 1000, 'seconds');
    startPopupFlood(data.duration);
  });

  socket.on('participant:update', (participant) => {
    console.log('Teilnehmer aktualisiert:', participant.login, 'Neues Glück:', participant.luck);
    
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
  elements.pickBtn?.addEventListener('click', pickRandomWinnerFromUI);
  elements.resetBtn?.addEventListener('click', EventHandlers.showResetConfirmation);
  
  document.getElementById('confirmReset')?.addEventListener('click', EventHandlers.confirmReset);
  document.getElementById('cancelReset')?.addEventListener('click', EventHandlers.cancelReset);
  
  // Settings Event Listeners
  elements.keywordInput?.addEventListener('blur', (e) => {
    SettingsManager.validateAndUpdateKeyword(e.target.value);
    // Remove validation classes when losing focus
    e.target.classList.remove('valid', 'invalid');
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
      
      // Lade Badge-Informationen des aktuellen Benutzers (nach AppState init)
      setTimeout(() => {
        loadUserBadges(me, AppState).catch(error => {
          console.warn('Badge-Laden fehlgeschlagen:', error);
        });
      }, 100); // Kurze Verzögerung um sicherzustellen, dass AppState vollständig initialisiert ist
      
      // Nach dem Laden des Benutzers authentifiziere den Socket
      const success = localSafeSocketEmit('auth', AppState.user.id);
      if (success) {
        console.group('🔌 Socket');
        console.log('Socket authentifiziert für Benutzer:', AppState.user.id);
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
    console.error('Chat-Verbindung fehlgeschlagen:', e);
    console.groupEnd();
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
      (pJson.participants || []).reverse().forEach(p => {
        elements.participantsList.appendChild(renderParticipant(p));
      });
    }
    AppState.giveaway.entries = (pJson.participants || []).length;
    StateManager.updateEntriesDisplay();
    StateManager.updateButtonStates();
    
    // WICHTIG: Update participant count to fix "No Participants Yet" display
    updateParticipantCount();
    
    // Initialize Lucide icons for loaded participants
    if (elements.participantsList) {
      lucide.createIcons(elements.participantsList);
    }
    
    setTimeout(() => checkScrollbar(), 100);
    
    console.log('📊 Initial participants loaded:', AppState.giveaway.entries);
  } catch (e) {
    console.error('Fehler beim Laden der Teilnehmer:', e);
  }

  try {
    const kwRes = await fetch('/api/settings/keyword');
    const kwJson = await kwRes.json();
    if (kwJson.keyword) {
      AppState.giveaway.keyword = kwJson.keyword;
      StateManager.updateKeywordDisplay();
    }
  } catch (e) {
    console.error('Fehler beim Laden des Schlüsselworts:', e);
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

  // Brand logo navigation - go back to Giveaways tab
  document.getElementById('brandLogo')?.addEventListener('click', () => {
    // Find the giveaways tab and simulate a click
    const giveawaysTab = document.querySelector('[data-tab="giveaways"]');
    if (giveawaysTab) {
      // Remove active state from all tabs
      document.querySelectorAll('.tab').forEach(t => {
        t.classList.remove('is-active');
        t.setAttribute('aria-selected', 'false');
      });
      
      // Activate giveaways tab
      giveawaysTab.classList.add('is-active');
      giveawaysTab.setAttribute('aria-selected', 'true');
      
      // Hide all views and show giveaways view
      document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('is-visible');
      });
      document.getElementById('giveaways')?.classList.add('is-visible');
      
      console.log('🏠 Navigated to Giveaways via brand logo');
    }
  });

  // Logout
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    window.location.href = '/logout';
  });

  // HELPER FUNCTIONS
  function showToast(message, type = 'success') {
    UIManager.showToast(message, type);
  }
  
  // Global winner selection function that works with test participants
  function pickRandomWinnerFromUI() {
    const participants = Array.from(elements.participantsList?.querySelectorAll('.participant-row') || []);
    
    if (participants.length === 0) {
      UIManager.showToast('No participants to pick from!', 'error');
      return;
    }
    
    // Filter out bot participants for winner selection
    const realParticipants = participants.filter(row => {
      const username = row.getAttribute('data-login') || 
                     row.querySelector('[data-remove]')?.getAttribute('data-remove') || '';
      return !username.startsWith('Bot_');
    });
    
    if (realParticipants.length === 0) {
      UIManager.showToast('No real participants to pick from (only bots)!', 'error');
      return;
    }
    
    // Pick random winner considering luck multipliers
    const winners = [];
    realParticipants.forEach(row => {
      const username = row.getAttribute('data-login') || 
                      row.querySelector('[data-remove]')?.getAttribute('data-remove') || '';
      const luckText = row.querySelector('.participant-luck')?.textContent || '1.0x';
      const luck = parseFloat(luckText.replace('x', '')) || 1.0;
      
      // Add multiple entries based on luck multiplier
      const entries = Math.max(1, Math.floor(luck * 10)); // Convert luck to entries
      for (let i = 0; i < entries; i++) {
        winners.push({
          element: row,
          username: username,
          luck: luck
        });
      }
    });
    
    // Pick random winner
    const randomIndex = Math.floor(Math.random() * winners.length);
    const selectedWinner = winners[randomIndex];
    
    // Create winner object
    const winner = {
      login: selectedWinner.username,
      display_name: selectedWinner.username,
      profileImageUrl: selectedWinner.element.querySelector('.participant-avatar')?.src || null,
      luck: selectedWinner.luck,
      userId: selectedWinner.element.getAttribute('data-user-id') || null
    };
    
    // Show winner modal
    showWinnerModal(winner);
    StateManager.updateStatus('INACTIVE');
    
    // Clear participants list after winner selection
    setTimeout(() => {
      clearAllParticipantsIncludingTestAndBots();
    }, 1000); // Wait 1 second so user can see the winner
    
    UIManager.showToast(`Winner selected: ${selectedWinner.username}`, 'success');
    console.log('Winner selected:', selectedWinner.username, 'Luck:', selectedWinner.luck);
  }

  function createConfetti() {
    const container = document.getElementById('confettiContainer');
    if (!container) return;

    // Entferne sofort alle vorherigen Konfetti-Animationen
    const existingGroups = container.querySelectorAll('.confetti-group');
    if (existingGroups.length > 0) {
      console.log('Entferne vorheriges Konfetti sofort für neues...');
      existingGroups.forEach(group => {
        group.remove();
      });
    }
    
    // Starte sofort neues Konfetti
    startNewConfetti();
    
    function startNewConfetti() {
      const confettiGroup = document.createElement('div');
      confettiGroup.className = 'confetti-group';
      confettiGroup.style.position = 'absolute';
      confettiGroup.style.width = '100%';
      confettiGroup.style.height = '100%';
      confettiGroup.style.pointerEvents = 'none';
      confettiGroup.style.opacity = '1';
      
      const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#f0932b', '#eb4d4b', '#6c5ce7'];
      
      for (let i = 0; i < 100; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.top = '-10px';
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.animationDelay = Math.random() * 3 + 's';
        confetti.style.animationDuration = (Math.random() * 3 + 2) + 's';
        confettiGroup.appendChild(confetti);
      }
      
      container.appendChild(confettiGroup);
      
      // Entferne diese Konfetti-Gruppe nach der Animation
      setTimeout(() => {
        const confettiElements = confettiGroup.querySelectorAll('.confetti');
        confettiElements.forEach(element => {
          element.style.animationIterationCount = '1';
        });
        
        setTimeout(() => {
          if (confettiGroup.parentNode) {
            confettiGroup.style.transition = 'opacity 1s ease-out';
            confettiGroup.style.opacity = '0';
            setTimeout(() => {
              if (confettiGroup.parentNode) {
                confettiGroup.remove();
              }
            }, 1000);
          }
        }, 5000);
      }, 5000);
    }
  }

  document.getElementById('closeWinnerModal')?.addEventListener('click', () => {
    const modal = document.getElementById('winnerModal');
    if (modal) {
      modal.classList.remove('modal--show');
      console.log('Gewinner Modal manuell geschlossen');
      console.groupEnd();
      
      // Konfetti läuft automatisch aus - wird durch setTimeout in createConfetti() selbst entfernt
      
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
      
      if (participants.length > 0) {
        // Animate all participants out at once (same as chat clear)
        participants.forEach((participant) => {
          participant.style.opacity = '0';
          participant.style.transform = 'translateX(-20px)';
          participant.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        });
        
        // Wait for animation to complete, then remove all at once
        setTimeout(() => {
          participants.forEach(participant => participant.remove());
          StateManager.updateEntriesDisplay();
          updateParticipantCount();
          console.log('Teilnehmerliste geleert');
        }, 200);
      } else {
        // No participants to animate
        StateManager.updateEntriesDisplay();
        updateParticipantCount();
        console.log('Teilnehmerliste geleert');
      }
    }
  }

  function clearParticipantsListAfterWinner() {
    if (elements.participantsList) {
      const participants = Array.from(elements.participantsList.children);
      if (participants.length > 0) {
        // Animate all participants out at once (same as chat clear)
        participants.forEach((participant) => {
          participant.style.opacity = '0';
          participant.style.transform = 'translateX(-20px)';
          participant.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        });
        
        // Wait for animation to complete, then remove all at once
        setTimeout(() => {
          participants.forEach(participant => participant.remove());
          StateManager.updateEntriesDisplay();
          console.log('Teilnehmerliste nach Gewinner geleert');
          
          // Show empty panel after additional delay
          setTimeout(() => {
            updateParticipantCount();
          }, 2000);
        }, 200);
      } else {
        // No participants to animate
        StateManager.updateEntriesDisplay();
        console.log('Teilnehmerliste nach Gewinner geleert');
        updateParticipantCount();
      }
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

  // Sort functionality
  elements.sortBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    elements.sortMenu?.classList.toggle('show');
  });

  // Close sort menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!elements.sortMenu?.contains(e.target) && !elements.sortBtn?.contains(e.target)) {
      elements.sortMenu?.classList.remove('show');
    }
  });

  // Sort options event listeners
  elements.sortMenu?.addEventListener('click', (e) => {
    const sortOption = e.target.closest('.sort-option');
    if (sortOption) {
      const sortType = sortOption.dataset.sort;
      sortParticipants(sortType);
      elements.sortMenu.classList.remove('show');
    }
  });

  function sortParticipants(sortType) {
    if (!elements.participantsList) return;
    
    const participants = Array.from(elements.participantsList.querySelectorAll('li'));
    
    participants.sort((a, b) => {
      switch (sortType) {
        case 'name-asc':
          const nameA = a.querySelector('.nick')?.textContent?.toLowerCase() || '';
          const nameB = b.querySelector('.nick')?.textContent?.toLowerCase() || '';
          return nameA.localeCompare(nameB);
          
        case 'name-desc':
          const nameA2 = a.querySelector('.nick')?.textContent?.toLowerCase() || '';
          const nameB2 = b.querySelector('.nick')?.textContent?.toLowerCase() || '';
          return nameB2.localeCompare(nameA2);
          
        case 'luck-asc':
          const luckA = parseFloat(a.querySelector('.participant-luck')?.textContent?.replace('x', '') || '1');
          const luckB = parseFloat(b.querySelector('.participant-luck')?.textContent?.replace('x', '') || '1');
          return luckA - luckB;
          
        case 'luck-desc':
          const luckA2 = parseFloat(a.querySelector('.participant-luck')?.textContent?.replace('x', '') || '1');
          const luckB2 = parseFloat(b.querySelector('.participant-luck')?.textContent?.replace('x', '') || '1');
          return luckB2 - luckA2;
          
        default:
          return 0;
      }
    });
    
    // Clear and re-append sorted participants
    elements.participantsList.innerHTML = '';
    participants.forEach(participant => {
      elements.participantsList.appendChild(participant);
    });
    
    // Re-initialize Lucide icons for the sorted elements
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

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
    const login = p.login || p.name || p.user || '';
    // Use exact Twitch display name or login as provided
    let display = p.display_name || p.displayName || p.display || login;
    const avatar = p.profileImageUrl || p.avatar || p.avatarUrl || '';
    const luck = p.luck || p.mult || 1.0;
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
      <li class="row participant-row" data-login="${login}" data-user-id="${p.userId || ''}">
        <div class="who">
          <div class="avatar">
            ${avatarHtml}
          </div>
          <div class="participant-info">
            <div class="participant-name">
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
        console.group('🗑️ Teilnehmer entfernen');
        console.log('Versuche Teilnehmer zu entfernen:', lg);
        
        // Check if this is a test participant or bot (client-side only)
        const isTestParticipant = lg.includes('TestUser_') || lg.includes('TestViewer_') || 
                                 lg.includes('DemoUser_') || lg.includes('SampleViewer_') ||
                                 lg.includes('ExampleUser_') || lg.includes('MockViewer_') ||
                                 lg.includes('FakeUser_') || lg.includes('TestAccount_') ||
                                 lg.includes('DummyUser_') || lg.includes('TrialUser_');
        const isBotParticipant = lg.startsWith('Bot_');
        
        if (isTestParticipant || isBotParticipant) {
          // Remove test/bot participants directly from UI
          console.log('Entferne Test/Bot-Teilnehmer direkt aus UI:', lg);
          console.groupEnd();
          
          li.style.opacity = '0';
          li.style.transform = 'translateX(-20px)';
          li.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
          
          setTimeout(() => {
            li.remove();
            AppState.giveaway.entries = Math.max(0, AppState.giveaway.entries - 1);
            StateManager.updateEntriesDisplay();
            StateManager.updateButtonStates();
            updateParticipantCount();
          }, 200);
          
          UIManager.showToast(`Removed ${isTestParticipant ? 'test participant' : 'bot'} ${lg}`, 'success');
          return;
        }
        
        // Handle real participants via server
        try {
          const res = await fetch(`/api/giveaway/participants/${encodeURIComponent(lg)}`, { 
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json'
            }
          });
          
          if (res.ok) {
            console.log('Teilnehmer erfolgreich entfernt:', lg);
            console.groupEnd();
            li.style.opacity = '0';
            li.style.transform = 'translateX(-20px)';
            li.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
            setTimeout(() => {
              li.remove();
              updateParticipantCount();
            }, 200);
          } else {
            const errorData = await res.json().catch(() => ({}));
            console.error('Fehler beim Entfernen des Teilnehmers:', res.status, errorData);
            console.groupEnd();
            UIManager.showToast(`Failed to remove ${lg}`, 'error');
          }
        } catch (error) {
          console.error('Fehler beim Entfernen des Teilnehmers:', error);
          console.groupEnd();
          UIManager.showToast(`Error removing ${lg}`, 'error');
        }
      });
    }
    
    return li;
  }

  function updateParticipantCount() {
    const allParticipants = elements.participantsList ? elements.participantsList.children.length : 0;
    
    // Force sync AppState with actual DOM count
    AppState.giveaway.entries = allParticipants;
    StateManager.updateEntriesDisplay();
    
    console.log('📊 Participant count updated:', allParticipants);
    
    if (elements.emptyPanel && elements.participantsList) {
      if (allParticipants === 0) {
        elements.emptyPanel.style.display = 'flex';
        elements.participantsList.style.display = 'none';
      } else {
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
      console.error('Nachricht senden fehlgeschlagen:', e);
    }
  });

  // ===================== EMOTE AUTOCOMPLETE SYSTEM =====================
  const EmoteAutocomplete = {
    emoteList: new Map(),
    isVisible: false,
    selectedIndex: -1,
    suggestions: [],
    
    init() {
      this.loadEmoteList();
      this.setupChatInput();
    },
    
    async loadEmoteList() {
      try {
        console.group('😀 Emotes');
        console.log('Lade Emotes vom Backend...');
        const response = await fetch('/api/emotes/all');
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        this.emoteList.clear();
        data.emotes.forEach(emote => {
          this.emoteList.set(emote.name.toLowerCase(), emote);
        });
        
        console.log(`${this.emoteList.size} Emotes für Autocomplete geladen:`, data.providers);
        
        // Show success notification
        UIManager.showToast(`Loaded ${data.count} emotes from ${Object.keys(data.providers).length} providers`, 'success');
        
      } catch (error) {
        console.error('Fehler beim Laden der Emotes:', error);
        console.groupEnd();
        
        // Fallback to hardcoded emotes
        const fallbackEmotes = [
          { name: 'Kappa', provider: 'Twitch', url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0' },
          { name: 'PogChamp', provider: 'Twitch', url: 'https://static-cdn.jtvnw.net/emoticons/v2/88/default/dark/1.0' },
          { name: 'KEKW', provider: 'BTTV', url: 'https://cdn.betterttv.net/emote/5e9c6c187e090362f8b0b9e8/1x' },
          { name: 'EZ', provider: 'BTTV', url: 'https://cdn.betterttv.net/emote/5590b223b344e2c42a9e28e3/1x' },
          { name: 'OMEGALUL', provider: 'BTTV', url: 'https://cdn.betterttv.net/emote/583089f4737a8e61abb0186b/1x' }
        ];
        
        this.emoteList.clear();
        fallbackEmotes.forEach(emote => {
          this.emoteList.set(emote.name.toLowerCase(), emote);
        });
        
        console.log(`Verwende Fallback Emotes: ${this.emoteList.size} Emotes`);
        console.groupEnd();
        UIManager.showToast('Using offline emote cache', 'warn');
      }
    },
    
    async refreshEmotes() {
      try {
        console.log('Emotes werden aktualisiert...');
        UIManager.showToast('Refreshing emotes...', 'info');
        
        const response = await fetch('/api/emotes/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('Emotes aktualisiert:', data.counts);
        
        // Reload emote list
        await this.loadEmoteList();
        
        UIManager.showToast(`Refreshed ${Object.values(data.counts).reduce((a, b) => a + b, 0)} emotes`, 'success');
        
      } catch (error) {
        console.error('Fehler beim Aktualisieren der Emotes:', error);
        UIManager.showToast('Failed to refresh emotes', 'error');
      }
    },
    
    async testEmoteParsing() {
      const testText = prompt('Enter text to test emote parsing (e.g., "Kappa KEKW :) :D <3"):');
      if (!testText) return;
      
      try {
        UIManager.showToast('Testing emote parsing...', 'info');
        
        const response = await fetch('/api/emotes/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: testText })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        console.group('🧪 Emote Parsing Test Results');
        console.groupEnd();
        
        // Show a preview in chat
        const testMessage = {
          channel: 'test',
          user: 'Test User',
          userId: 'test',
          text: data.originalText,
          message: data.finalResult,
          color: '#ff6b6b',
          badges: [],
          luck: 1,
          multiplierText: '1.00x',
          timestamp: new Date().toISOString(),
          isParticipant: false,
          profileImageUrl: null,
          isTest: true
        };
        
        // Temporarily emit to chat for visual testing
        if (elements.chatList) {
          const empty = elements.chatList.querySelector('.empty');
          if (empty) empty.remove();
          
          const row = el(`
            <div class="msg test-msg" style="border-left: 3px solid #ff6b6b;" data-username="Test User">
              <div class="msg-content">
                <div class="chat-user-info">
                  <span class="user" style="color:#ff6b6b">TEST:</span>
                </div>
                <span class="msg-text">${data.finalResult}</span>
              </div>
            </div>
          `);
          elements.chatList.appendChild(row);
          elements.chatList.scrollTop = elements.chatList.scrollHeight;
          
          // Remove test message after 10 seconds
          setTimeout(() => {
            if (row.parentNode) row.remove();
          }, 10000);
        }
        
        UIManager.showToast(`Test completed! Check console for details.`, 'success');
        
      } catch (error) {
        console.error('Fehler beim Testen des Emote-Parsings:', error);
        UIManager.showToast('Failed to test emote parsing', 'error');
      }
    },
    
    async showChannelEmotes() {
      try {
        // Get current user's channel ID
        const user = await fetch('/api/me').then(r => r.json());
        if (!user.loggedIn) {
          UIManager.showToast('Not logged in', 'error');
          return;
        }
        
        console.log(`Lade Channel-Emotes für ${user.displayName} (${user.id})...`);
        
        const response = await fetch(`/api/emotes/channel/${user.id}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        console.group('📺 Channel Emotes for ' + user.displayName);
        console.log(`Gesamt: ${data.totalEmotes} Emotes`);
        console.log('Nach Typ:', data.emotesByType);
        console.groupEnd();
        
        // Create a temporary list in chat
        if (elements.chatList && data.totalEmotes > 0) {
          const empty = elements.chatList.querySelector('.empty');
          if (empty) empty.remove();
          
          const emotesByType = Object.entries(data.emotesByType);
          const emotePreview = emotesByType.map(([type, emotes]) => 
            `<strong>${type.toUpperCase()}:</strong> ${emotes.slice(0, 3).map(e => e.name).join(', ')}${emotes.length > 3 ? ` (+${emotes.length - 3} more)` : ''}`
          ).join('<br>');
          
          const row = el(`
            <div class="msg info-msg" style="border-left: 3px solid #00d4ff;" data-username="Channel Info">
              <div class="msg-content">
                <div class="chat-user-info">
                  <span class="user" style="color:#00d4ff">📺 CHANNEL EMOTES:</span>
                </div>
                <span class="msg-text">
                  <strong>${data.totalEmotes} emotes available</strong><br>
                  ${emotePreview}
                </span>
              </div>
            </div>
          `);
          elements.chatList.appendChild(row);
          elements.chatList.scrollTop = elements.chatList.scrollHeight;
          
          // Remove info message after 15 seconds
          setTimeout(() => {
            if (row.parentNode) row.remove();
          }, 15000);
          
          UIManager.showToast(`Found ${data.totalEmotes} broadcaster emotes`, 'success');
        } else {
          UIManager.showToast('No channel emotes found', 'warn');
        }
        
      } catch (error) {
        console.error('Fehler beim Laden der Channel-Emotes:', error);
        UIManager.showToast('Failed to get channel emotes', 'error');
      }
    },
    
    setupChatInput() {
      const chatInput = document.getElementById('simMsg');
      if (!chatInput) return;
      
      // Create autocomplete container
      const autocompleteContainer = document.createElement('div');
      autocompleteContainer.id = 'emoteAutocomplete';
      autocompleteContainer.className = 'emote-autocomplete hidden';
      chatInput.parentElement.appendChild(autocompleteContainer);
      
      // Input event handlers
      chatInput.addEventListener('input', (e) => this.handleInput(e));
      chatInput.addEventListener('keydown', (e) => this.handleKeydown(e));
      chatInput.addEventListener('blur', () => {
        // Delay hiding to allow clicking on suggestions
        setTimeout(() => this.hide(), 150);
      });
      
      // Global click handler to hide autocomplete
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#emoteAutocomplete') && !e.target.closest('#simMsg')) {
          this.hide();
        }
      });
    },
    
    handleInput(e) {
      const input = e.target;
      const text = input.value;
      const cursorPos = input.selectionStart;
      
      // Find word at cursor position
      const beforeCursor = text.substring(0, cursorPos);
      const afterCursor = text.substring(cursorPos);
      
      // Look for emote pattern (word that might be an emote)
      const wordMatch = beforeCursor.match(/(\S+)$/);
      if (!wordMatch) {
        this.hide();
        return;
      }
      
      const currentWord = wordMatch[1];
      
      // Only show suggestions if word is at least 2 characters
      if (currentWord.length < 2) {
        this.hide();
        return;
      }
      
      this.showSuggestions(currentWord, input);
    },
    
    handleKeydown(e) {
      if (!this.isVisible) return;
      
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          this.selectedIndex = Math.min(this.selectedIndex + 1, this.suggestions.length - 1);
          this.updateSelection();
          break;
          
        case 'ArrowUp':
          e.preventDefault();
          this.selectedIndex = Math.max(this.selectedIndex - 1, -1);
          this.updateSelection();
          break;
          
        case 'Enter':
        case 'Tab':
          e.preventDefault();
          if (this.selectedIndex >= 0) {
            this.insertEmote(this.suggestions[this.selectedIndex], e.target);
          }
          break;
          
        case 'Escape':
          this.hide();
          break;
      }
    },
    
    showSuggestions(query, inputElement) {
      const suggestions = [];
      const queryLower = query.toLowerCase();
      
      // Check if query is a provider name to show all emotes from that provider
      const providerMap = {
        'twitch': 'Twitch',
        'bttv': 'BTTV', 
        'ffz': 'FFZ',
        '7tv': '7TV',
        'seventv': '7TV'
      };
      
      const isProviderQuery = providerMap[queryLower];
      
      if (isProviderQuery) {
        // Show all emotes from specific provider
        for (const [emoteName, emoteData] of this.emoteList) {
          if (emoteData.provider === isProviderQuery) {
            suggestions.push({
              ...emoteData,
              similarity: 80 // Medium priority for provider matches
            });
          }
        }
      } else {
        // Find matching emotes by name
        for (const [emoteName, emoteData] of this.emoteList) {
          if (emoteName.includes(queryLower)) {
            suggestions.push({
              ...emoteData,
              similarity: this.calculateSimilarity(queryLower, emoteName)
            });
          }
        }
      }
      
      // Sort by similarity and limit to 12 results (increased for provider queries)
      suggestions.sort((a, b) => b.similarity - a.similarity);
      this.suggestions = suggestions.slice(0, isProviderQuery ? 12 : 8);
      
      if (this.suggestions.length === 0) {
        this.hide();
        return;
      }
      
      this.render(inputElement);
      this.selectedIndex = -1;
      this.isVisible = true;
    },
    
    calculateSimilarity(query, emoteName) {
      if (emoteName.startsWith(query)) return 100;
      if (emoteName.includes(query)) return 50;
      return 0;
    },
    
    render(inputElement) {
      const container = document.getElementById('emoteAutocomplete');
      if (!container) return;
      
      container.innerHTML = '';
      container.className = 'emote-autocomplete';
      
      this.suggestions.forEach((emote, index) => {
        const item = document.createElement('div');
        item.className = 'emote-suggestion';
        
        // Add animated class to suggestion emote image if it's animated
        const animatedClass = emote.animated ? ' emote-animated' : '';
        const animatedIndicator = emote.animated ? ' 🎬' : '';
        
        item.innerHTML = `
          <img src="${escapeHtml(emote.url)}" alt="${escapeHtml(emote.name)}" class="suggestion-emote${animatedClass}" onerror="this.style.display='none'">
          <div class="suggestion-info">
            <div class="suggestion-name">${escapeHtml(emote.name)}${animatedIndicator}</div>
            <div class="suggestion-provider">${escapeHtml(emote.provider)}</div>
          </div>
        `;
        
        item.addEventListener('click', () => {
          this.insertEmote(emote, inputElement);
        });
        
        container.appendChild(item);
      });
      
      // Position the autocomplete
      const inputRect = inputElement.getBoundingClientRect();
      const containerRect = inputElement.parentElement.getBoundingClientRect();
      
      container.style.bottom = `${containerRect.bottom - inputRect.top + 5}px`;
      container.style.left = '0';
      container.style.right = '0';
    },
    
    updateSelection() {
      const suggestions = document.querySelectorAll('.emote-suggestion');
      suggestions.forEach((item, index) => {
        item.classList.toggle('selected', index === this.selectedIndex);
      });
    },
    
    insertEmote(emote, inputElement) {
      const text = inputElement.value;
      const cursorPos = inputElement.selectionStart;
      
      // Find the word to replace
      const beforeCursor = text.substring(0, cursorPos);
      const afterCursor = text.substring(cursorPos);
      const wordMatch = beforeCursor.match(/(\S+)$/);
      
      if (wordMatch) {
        const wordStart = cursorPos - wordMatch[1].length;
        const newText = text.substring(0, wordStart) + emote.name + ' ' + afterCursor;
        
        inputElement.value = newText;
        inputElement.setSelectionRange(wordStart + emote.name.length + 1, wordStart + emote.name.length + 1);
        inputElement.focus();
      }
      
      this.hide();
    },
    
    hide() {
      const container = document.getElementById('emoteAutocomplete');
      if (container) {
        container.className = 'emote-autocomplete hidden';
      }
      this.isVisible = false;
      this.selectedIndex = -1;
      this.suggestions = [];
    }
  };

  document.getElementById('simMsg')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('sendSim')?.click();
    }
  });
  
  // Initialize emote autocomplete
  EmoteAutocomplete.init();

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
    
    // Cache Badges und Luck für aktuellen Benutzer falls es seine Nachricht ist
    if (AppState.user && name.toLowerCase() === AppState.user.login.toLowerCase()) {
      if (ev.badges && ev.badges.length > 0) {
        AppState.userBadges = ev.badges;
      }
      if (ev.luck && ev.luck > 1) {
        AppState.userLuck = ev.luck;
      }
    }
    
    // Verwende gecachte Badges für Website-Nachrichten des aktuellen Benutzers
    let badgesForMessage = ev.badges || [];
    if (ev.isWebsiteMessage && AppState.user && name.toLowerCase() === AppState.user.login.toLowerCase()) {
      badgesForMessage = AppState.userBadges || [];
    }
    
    const badges = renderBadges(badgesForMessage);
    
    // Verwende gecachte Luck für Website-Nachrichten des aktuellen Benutzers
    let luckForMessage = ev.luck;
    if (ev.isWebsiteMessage && AppState.user && name.toLowerCase() === AppState.user.login.toLowerCase()) {
      luckForMessage = AppState.userLuck || ev.luck;
    }
    
    // ✅ KORRIGIERT: Zeige Luck-Multiplier richtig an
    const multiplierText = (luckForMessage && luckForMessage > 1) ? `${luckForMessage.toFixed(2)}x` : '';
    const isParticipant = ev.isParticipant || false;
    
    console.group('💬 Chat Nachricht');
    console.log('Zeige Chat-Nachricht:', {
      user: name,
      message: msg,
      emotes: ev.emotes,
      isWebsiteMessage: ev.isWebsiteMessage,
      badgeCount: badgesForMessage.length,
      badges: badgesForMessage.map(b => b.name),
      originalLuck: ev.luck,
      usedLuck: luckForMessage,
      multiplierText,
      cachedBadges: ev.isWebsiteMessage ? AppState.userBadges.length : 'N/A'
    });
      
    const empty = elements.chatList.querySelector('.empty');
    if (empty) empty.remove();
    
    // Check if message contains emote HTML that should not be escaped
    const containsEmoteHtml = msg.includes('<img') && msg.includes('chat-emote');
    const messageContent = containsEmoteHtml ? msg : escapeHtml(msg);
    
    const row = el(`
      <div class="msg ${isParticipant ? 'participant-msg' : ''}" data-username="${escapeHtml(name)}">
        <div class="msg-content">
          <div class="chat-user-info">
            ${badges}
            <span class="user" style="color:${color}">${escapeHtml(name)}:</span>
            ${multiplierText ? `<span class="luck-indicator">${multiplierText}</span>` : ''}
          </div>
          <span class="msg-text">${messageContent}</span>
          <button class="copy-message-btn" title="Copy message" data-message="${escapeHtml(getPlainTextFromMessage(ev))}" onclick="copyMessageToClipboard(this)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
            </svg>
          </button>
        </div>
      </div>
    `);
    elements.chatList.appendChild(row);
    
    // Enhance emotes in the message with emote data from server
    enhanceEmotesInMessage(row, ev.emotes);
    
    // Check if message should wrap like Twitch
    checkMessageWrap(row);
    
    elements.chatList.scrollTop = elements.chatList.scrollHeight;
    
    // Check for admin commands
    processAdminCommand(ev);
  });
  
  // Admin Commands System
  function processAdminCommand(chatEvent) {
    const msg = (chatEvent?.message ?? chatEvent?.text ?? '').toString().trim();
    const user = chatEvent?.user || '';
    
    // Check if message is a command
    if (!msg.startsWith('!')) return;
    
    // Get the command name
    const parts = msg.slice(1).split(' ');
    const command = parts[0].toLowerCase();
    
    // Only process actual admin commands, not giveaway keywords
    const adminCommands = ['pick', 'add', 'set', 'crash', 'popup'];
    if (!adminCommands.includes(command)) return;
    
    // Debug: Log chat event structure
    console.log('🔍 Chat Event Debug:', {
      user: user,
      isBroadcaster: chatEvent.isBroadcaster,
      isMod: chatEvent.isMod,
      badges: chatEvent.badges,
      userInfo: chatEvent.userInfo
    });
    
    // Check if user is admin (broadcaster or mod)
    // Try multiple ways to detect admin status
    const isAdmin = chatEvent.isBroadcaster || 
                   chatEvent.isMod || 
                   chatEvent.badges?.broadcaster || 
                   chatEvent.badges?.moderator ||
                   (chatEvent.userInfo && (chatEvent.userInfo.isBroadcaster || chatEvent.userInfo.isMod)) ||
                   AdminSystem.isAdmin || // Fallback to local admin system
                   isManualAdmin(user); // Manual admin list
    
    function isManualAdmin(username) {
      // Add your Twitch username here for manual admin access
      const manualAdmins = ['alexej_zinxy']; // Replace with your actual username
      return manualAdmins.includes(username.toLowerCase());
    }
    
    if (!isAdmin) {
      console.log('❌ User is not admin:', user);
      return;
    }
    
    console.log('✅ Admin command detected from:', user);
    
    const subcommand = parts[1]?.toLowerCase();
    const args = parts.slice(2);
    
    // Handle popup command separately (doesn't need active giveaway)
    if (command === 'popup') {
      // For popup, args should be everything after 'popup'
      const popupArgs = parts.slice(1);
      handlePopupCommand(popupArgs);
      return;
    }
    
    // Check if giveaway is active (for other commands)
    if (AppState.giveaway.status !== 'ACTIVE') {
      sendAdminFeedback(`⚠️ Commands only work during active giveaway`, 'warn');
      return;
    }
    
    switch (command) {
      case 'pick':
        handlePickCommand(subcommand, args);
        break;
      case 'add':
        handleAddCommand(subcommand, args);
        break;
      case 'set':
        handleSetCommand(parts.slice(1));
        break;
      case 'crash':
        handleCrashCommand();
        break;
    }
  }
  
  function handlePickCommand(subcommand, args) {
    if (subcommand === 'winner') {
      if (args.length === 0) {
        // Random winner selection from UI participants
        pickRandomWinnerFromUI();
        sendAdminFeedback('Picking random winner...', 'success');
      } else {
        // Specific winner selection
        const username = args[0];
        pickSpecificWinner(username);
      }
    }
  }
  
  function handleAddCommand(subcommand, args) {
    const count = parseInt(args[0]) || 0;
    if (count <= 0) {
      sendAdminFeedback('❌ Invalid number', 'error');
      return;
    }
    
    if (subcommand === 'participants') {
      addTestParticipants(count);
      sendAdminFeedback(`✅ Added ${count} test participants`, 'success');
    } else if (subcommand === 'bot') {
      addBotParticipants(count);
      sendAdminFeedback(`🤖 Added ${count} bot participants`, 'success');
    }
  }
  
  function handleSetCommand(args) {
    // !set <username> luck <multiplier>
    if (args.length < 3 || args[1] !== 'luck') {
      sendAdminFeedback('❌ Usage: !set <username> luck <multiplier>', 'error');
      return;
    }
    
    const username = args[0];
    const multiplier = parseFloat(args[2]);
    
    if (isNaN(multiplier) || multiplier <= 0) {
      sendAdminFeedback('❌ Invalid luck multiplier', 'error');
      return;
    }
    
    setParticipantLuck(username, multiplier);
  }
  
  function handleCrashCommand() {
    const errors = [
      {
        code: 'ERR_CONNECTION_REFUSED',
        message: 'unable to calculate your weight.',
        suggestions: ['Check if your scale is plugged in', 'Try stepping on and off the scale', 'Calibrate the scale']
      },
      {
        code: 'ERR_WEIGHT_NOT_HANDLED',
        message: 'unable to handle weight parameter.',
        suggestions: ['Make sure you\'re standing still', 'Remove any heavy objects from your pockets', 'Try again in 30 seconds']
      },
      {
        code: '413 PAYLOAD_TOO_LARGE',
        message: 'scale rejected the request.',
        suggestions: ['Consider a gym membership', 'Try a industrial scale instead', 'Maybe measure in smaller increments']
      },
      {
        code: '422 UNPROCESSABLE_ENTITY',
        message: 'weight input exceeds numeric range.',
        suggestions: ['Are you perhaps a blue whale?', 'Check if scale is set to correct units', 'Try scientific notation']
      },
      {
        code: '424 FAILED_DEPENDENCY',
        message: 'belt requires extra holes.',
        suggestions: ['Visit your local tailor', 'Consider suspenders as alternative', 'Emergency rope backup recommended']
      },
      {
        code: '304 NOT_MODIFIED',
        message: 'diet plan unchanged since last year.',
        suggestions: ['Maybe try actually following the diet?', 'Switch to a different diet plan', 'Consult a nutritionist']
      }
    ];

    const randomError = errors[Math.floor(Math.random() * errors.length)];
    
    showCrashScreen(randomError);
  }

  function showCrashScreen(error) {
    // Create full-screen crash overlay that replaces entire page
    const crashOverlay = document.createElement('div');
    crashOverlay.className = 'chrome-error-page';
    crashOverlay.innerHTML = `
      <div class="error-content">
        <div class="error-icon">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <g>
              <!-- Document/Page icon like Chrome -->
              <rect x="12" y="8" width="32" height="44" rx="2" fill="#5f6368" stroke="none"/>
              
              <!-- Page corner fold -->
              <path d="M36 8 L36 18 L44 18 L36 8" fill="#3c4043"/>
              
              <!-- Sad face on document -->
              <g transform="translate(28, 26)">
                <!-- Eyes -->
                <circle cx="-3" cy="-2" r="1" fill="#9aa0a6"/>
                <circle cx="3" cy="-2" r="1" fill="#9aa0a6"/>
                <!-- Sad mouth -->
                <path d="M-4 3 Q0 1 4 3" fill="none" stroke="#9aa0a6" stroke-width="1" stroke-linecap="round"/>
              </g>
              
              <!-- Small X or error indicator -->
              <circle cx="42" cy="16" r="6" fill="#ea4335"/>
              <g stroke="#ffffff" stroke-width="1.5" stroke-linecap="round">
                <path d="M39 13 L45 19"/>
                <path d="M45 13 L39 19"/>
              </g>
            </g>
          </svg>
        </div>
        
        <div class="error-text">
          <h1>This site can't be reached</h1>
          <p class="error-description"><strong>localhost</strong> belt requires extra holes.</p>
          <p class="error-code">424 FAILED_DEPENDENCY</p>
        </div>
        
        <div class="suggestions">
          <p>Try:</p>
          <ul>
            ${error.suggestions.map(suggestion => `<li>${suggestion}</li>`).join('')}
          </ul>
        </div>
        
        <div class="button-row">
          <button class="reload-button" onclick="location.reload()">Reload</button>
          <div class="advanced-section">
            <details>
              <summary>Advanced</summary>
              <div class="advanced-content">
                <p>Error occurred at: ${new Date().toISOString()}</p>
                <p>Error code: 424 FAILED_DEPENDENCY</p> 
                <p>Request ID: ${Math.random().toString(36).substr(2, 12).toUpperCase()}</p>
              </div>
            </details>
          </div>
        </div>
        
      </div>
    `;

    // Add Chrome-like styles if not already present
    if (!document.getElementById('chrome-error-styles')) {
      const chromeStyles = document.createElement('style');
      chromeStyles.id = 'chrome-error-styles';
      chromeStyles.textContent = `
        .chrome-error-page {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: #ffffff;
          z-index: 10000;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #202124;
          overflow: hidden;
        }
        
        .error-container {
          width: 100%;
          height: 100vh;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          text-align: center;
          position: relative;
          padding: 40px;
          box-sizing: border-box;
          max-width: 600px;
        }
        
        .icon-wrapper {
          margin-bottom: 32px;
        }
        
        .connection-icon {
          display: flex;
          justify-content: center;
          align-items: center;
        }
        
        .connection-icon svg {
          width: 100px;
          height: 100px;
        }
        
        .error-content h1 {
          font-size: 32px;
          font-weight: 400;
          color: #202124;
          margin: 0 0 16px 0;
          line-height: 1.25;
          letter-spacing: 0;
        }
        
        .error-url {
          font-size: 16px;
          color: #5f6368;
          margin: 0 0 8px 0;
          line-height: 1.4;
        }
        
        .error-url strong {
          color: #202124;
          font-weight: 400;
        }
        
        .error-code {
          font-family: "Roboto Mono", monospace;
          font-size: 14px;
          font-weight: 400;
          color: #5f6368;
          margin: 0 0 40px 0;
          letter-spacing: 0.25px;
        }
        
        .suggestions-section {
          width: 100%;
          margin-bottom: 40px;
        }
        
        .suggestions-list {
          margin: 0;
          padding: 0;
          list-style: none;
          text-align: left;
        }
        
        .suggestions-list li {
          font-size: 14px;
          color: #5f6368;
          margin: 8px 0;
          position: relative;
          padding-left: 20px;
          line-height: 1.4;
        }
        
        .suggestions-list li:before {
          content: "• ";
          position: absolute;
          left: 0;
          color: #5f6368;
          font-weight: bold;
        }
        
        .error-actions {
          margin-bottom: 40px;
        }
        
        .reload-btn {
          background: #1a73e8;
          color: white;
          border: none;
          padding: 10px 24px;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.1s ease;
          box-shadow: none;
          outline: none;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        }
        
        .reload-btn:hover {
          background: #1557b2;
          box-shadow: 0 1px 2px 0 rgba(26,115,232,0.45);
        }
        
        .reload-btn:active {
          background: #1248a0;
          box-shadow: 0 2px 4px 0 rgba(26,115,232,0.3);
        }
        
        .chrome-btn-outline {
          background: transparent;
          color: #1a73e8;
          border: 1px solid #dadce0;
          padding: 9px 23px;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          margin: 0 8px;
          transition: all 0.1s ease;
        }
        
        .chrome-btn-outline:hover {
          background: rgba(26,115,232,0.04);
          border-color: #1a73e8;
        }
        
        .error-details {
          margin-top: 40px;
          text-align: left;
          max-width: 600px;
          width: 100%;
        }
        
        .details-toggle {
          color: #1a73e8;
          cursor: pointer;
          font-size: 14px;
          text-decoration: none;
        }
        
        .details-toggle:hover {
          text-decoration: underline;
        }
        
        .details-content {
          margin-top: 12px;
          padding: 12px;
          background: #f8f9fa;
          border-radius: 4px;
          font-size: 12px;
          color: #5f6368;
          font-family: "Roboto Mono", monospace;
        }
        
        .details-content p {
          margin: 4px 0;
        }
        
        .close-error {
          position: absolute;
          top: 20px;
          right: 20px;
          background: none;
          border: none;
          font-size: 24px;
          color: #5f6368;
          cursor: pointer;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background-color 0.1s ease;
        }
        
        .close-error:hover {
          background: rgba(60,64,67,0.08);
        }
        
        @media (max-width: 768px) {
          .error-container {
            padding: 0 20px;
          }
          
          .offline-icon svg {
            width: 100px;
            height: 100px;
          }
          
          .error-content h1 {
            font-size: 24px;
          }
          
          .error-content p, .suggestions-list li {
            font-size: 14px;
          }
          
          .chrome-btn {
            padding: 10px 24px;
            font-size: 14px;
          }
        }
        
        /* New Chrome Error Styles */
        .chrome-error-page {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: #202124;
          z-index: 10000;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          color: #9aa0a6;
          overflow: hidden;
          margin: 0;
          padding: 0;
        }
        
        .error-content {
          position: absolute;
          left: 50%;
          top: 45%;
          transform: translate(-50%, -50%);
          text-align: left;
          width: 100%;
          max-width: 800px;
          padding: 0 60px;
          box-sizing: border-box;
        }
        
        .error-icon {
          margin: 0 0 24px 0;
          display: block;
          text-align: left;
        }
        
        .error-icon svg {
          width: 72px;
          height: 72px;
        }
        
        .error-text h1 {
          font-size: 32px;
          font-weight: 400;
          color: #9aa0a6;
          margin: 0 0 20px 0;
          line-height: 40px;
          letter-spacing: 0;
          text-align: left;
        }
        
        .error-description {
          font-size: 18px;
          color: #9aa0a6;
          margin: 0 0 12px 0;
          line-height: 26px;
          text-align: left;
        }
        
        .error-description strong {
          color: #8ab4f8;
          font-weight: 500;
        }
        
        .error-code {
          font-family: "Roboto Mono", "Consolas", "Courier New", monospace;
          font-size: 16px;
          font-weight: 400;
          color: #5f6368;
          margin: 0 0 32px 0;
          letter-spacing: 0.25px;
          text-align: left;
        }
        
        .suggestions {
          text-align: left;
          margin: 0 0 36px 0;
          max-width: 100%;
        }
        
        .suggestions p {
          font-size: 16px;
          color: #9aa0a6;
          font-weight: 500;
          margin: 0 0 16px 0;
        }
        
        .suggestions ul {
          margin: 0;
          padding: 0;
          list-style: none;
        }
        
        .suggestions li {
          font-size: 16px;
          color: #8ab4f8;
          margin: 10px 0;
          position: relative;
          padding-left: 20px;
          line-height: 24px;
        }
        
        .suggestions li:before {
          content: "•";
          position: absolute;
          left: 0;
          color: #9aa0a6;
          font-weight: bold;
        }
        
        .button-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          margin-bottom: 36px;
          width: 100%;
          max-width: 100%;
        }
        
        .reload-button {
          background: #8ab4f8;
          color: #202124;
          border: none;
          padding: 12px 28px;
          border-radius: 4px;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.1s ease;
          box-shadow: none;
          outline: none;
          font-family: inherit;
          margin: 0;
        }
        
        .reload-button:hover {
          background: #aecbfa;
          box-shadow: 0 1px 2px 0 rgba(138,180,248,0.45);
        }
        
        .reload-button:active {
          background: #669df6;
          transform: translateY(1px);
        }
        
        .reload-button:focus {
          box-shadow: 0 0 0 2px rgba(138,180,248,0.3);
        }
        
        .advanced-section {
          text-align: left;
          margin: 0;
          position: relative;
        }
        
        .advanced-section details {
          margin: 0;
        }
        
        .advanced-section summary {
          color: #8ab4f8;
          cursor: pointer;
          font-size: 16px;
          font-weight: 500;
          outline: none;
          padding: 12px 0;
          list-style: none;
        }
        
        .advanced-section summary::-webkit-details-marker {
          display: none;
        }
        
        .advanced-section summary:hover {
          text-decoration: underline;
        }
        
        .advanced-content {
          background: #3c4043;
          border: 1px solid #5f6368;
          border-radius: 8px;
          padding: 16px;
          margin-top: 8px;
          font-family: "Roboto Mono", "Consolas", "Courier New", monospace;
          font-size: 12px;
          color: #9aa0a6;
          line-height: 16px;
          position: absolute;
          right: 0;
          width: 300px;
          z-index: 1000;
        }
        
        .advanced-content p {
          margin: 0 0 4px 0;
        }
        
        
        @media (max-width: 1024px) {
          .error-content {
            max-width: 700px;
            padding: 0 40px;
          }
          
          .error-text h1 {
            font-size: 28px;
            line-height: 36px;
          }
          
          .error-description {
            font-size: 16px;
          }
        }
        
        @media (max-width: 768px) {
          .error-content {
            max-width: 500px;
            padding: 0 30px;
          }
          
          .error-icon {
            margin: 0 0 16px 0;
          }
          
          .error-icon svg {
            width: 60px;
            height: 60px;
          }
          
          .error-text h1 {
            font-size: 24px;
            line-height: 32px;
            margin: 0 0 16px 0;
          }
          
          .error-description {
            font-size: 15px;
            line-height: 22px;
            margin: 0 0 10px 0;
          }
          
          .error-code {
            font-size: 14px;
            margin: 0 0 24px 0;
          }
          
          .suggestions {
            margin: 0 0 28px 0;
          }
          
          .suggestions p {
            font-size: 14px;
            margin: 0 0 12px 0;
          }
          
          .suggestions li {
            font-size: 14px;
            line-height: 20px;
            margin: 8px 0;
            padding-left: 16px;
          }
          
          .button-row {
            flex-direction: column;
            align-items: flex-start;
            gap: 16px;
            margin-bottom: 24px;
          }
          
          .reload-button {
            padding: 10px 24px;
            font-size: 14px;
          }
          
          .advanced-section summary {
            font-size: 14px;
            padding: 8px 0;
          }
          
          .advanced-content {
            width: 280px;
            font-size: 11px;
          }
        }
        
        @media (max-width: 480px) {
          .error-content {
            max-width: 100%;
            padding: 0 20px;
          }
          
          
          .error-icon {
            margin-bottom: 12px;
          }
          
          .error-icon svg {
            width: 52px;
            height: 52px;
          }
          
          .error-text h1 {
            font-size: 20px;
            line-height: 28px;
            margin: 0 0 12px 0;
          }
          
          .error-description {
            font-size: 14px;
            line-height: 20px;
            margin: 0 0 8px 0;
          }
          
          .error-code {
            font-size: 12px;
            margin: 0 0 20px 0;
          }
          
          .suggestions {
            margin: 0 0 20px 0;
          }
          
          .suggestions p {
            font-size: 13px;
            margin: 0 0 10px 0;
          }
          
          .suggestions li {
            font-size: 13px;
            line-height: 18px;
            margin: 6px 0;
            padding-left: 14px;
          }
          
          .button-row {
            gap: 12px;
            margin-bottom: 20px;
          }
          
          .reload-button {
            padding: 8px 20px;
            font-size: 13px;
          }
          
          .advanced-section summary {
            font-size: 13px;
            padding: 6px 0;
          }
          
          .advanced-content {
            width: 250px;
            padding: 12px;
            font-size: 10px;
          }
        }
      `;
      document.head.appendChild(chromeStyles);
    }

    document.body.appendChild(crashOverlay);
    
    // Add smooth entrance animation
    crashOverlay.style.opacity = '0';
    requestAnimationFrame(() => {
      crashOverlay.style.transition = 'opacity 0.2s ease';
      crashOverlay.style.opacity = '1';
    });
  }

  function handlePopupCommand(args) {
    console.log('🚀 Frontend popup command received with args:', args);
    if (args.length === 0 || isNaN(args[0])) {
      sendAdminFeedback('❌ Usage: !popup <seconds>', 'error');
      return;
    }
    
    const duration = parseInt(args[0]);
    if (duration < 1 || duration > 300) {
      sendAdminFeedback('❌ Duration must be between 1-300 seconds', 'error');
      return;
    }
    
    console.log(`✅ Starting popup flood for ${duration} seconds`);
    sendAdminFeedback(`🦠 Popup virus started for ${duration} seconds!`, 'success');
    
    // Start the popup system
    startPopupFlood(duration * 1000); // Convert to milliseconds
  }

  function pickSpecificWinner(username) {
    // Debug: Log all participants
    const allParticipants = elements.participantsList?.querySelectorAll('.participant-row');
    console.log('🔍 All participants:', Array.from(allParticipants || []).map(p => ({
      dataLogin: p.getAttribute('data-login'),
      dataRemove: p.querySelector('[data-remove]')?.getAttribute('data-remove'),
      textContent: p.textContent.trim()
    })));
    
    // Check if user is in participants list - try multiple selectors
    let participantItem = elements.participantsList?.querySelector(`[data-login="${username}"]`) ||
                         elements.participantsList?.querySelector(`[data-remove="${username}"]`) ||
                         Array.from(elements.participantsList?.querySelectorAll('.participant-row') || [])
                           .find(row => row.textContent.toLowerCase().includes(username.toLowerCase()));
    
    if (!participantItem) {
      sendAdminFeedback(`❌ ${username} is not in participants list`, 'error');
      console.log('❌ Could not find participant:', username);
      return;
    }
    
    console.log('✅ Found participant:', participantItem);
    
    // Create winner object similar to server response
    const winner = {
      login: username,
      display_name: username,
      profileImageUrl: participantItem.querySelector('.participant-avatar')?.src || null,
      luck: parseFloat(participantItem.querySelector('.participant-luck')?.textContent?.replace('x', '')) || 1.0,
      userId: participantItem.getAttribute('data-user-id') || null
    };
    
    // Show winner modal directly
    showWinnerModal(winner);
    
    // Update giveaway status
    StateManager.updateStatus('INACTIVE');
    
    // Clear participants list after winner selection
    setTimeout(() => {
      clearAllParticipantsIncludingTestAndBots();
    }, 1000); // Wait 1 second so user can see the winner
    
    sendAdminFeedback(`🎯 Selected ${username} as winner!`, 'success');
    
    console.log('🎯 Admin selected specific winner:', username);
  }
  
  function addTestParticipants(count) {
    const testNames = [
      'TestUser', 'TestViewer', 'DemoUser', 'SampleViewer', 'ExampleUser', 
      'MockViewer', 'FakeUser', 'TestAccount', 'DummyUser', 'TrialUser'
    ];
    
    for (let i = 0; i < count; i++) {
      const baseName = testNames[i % testNames.length];
      const name = baseName + '_' + Math.floor(Math.random() * 10000);
      
      // Add participant directly to UI
      addParticipantToUI({
        login: name,
        display_name: name,
        profileImageUrl: null,
        luck: 1.0,
        userId: 'test_' + Math.floor(Math.random() * 100000)
      });
    }
    
    console.log(`✅ Added ${count} test participants to UI`);
  }
  
  function addBotParticipants(count) {
    for (let i = 0; i < count; i++) {
      const name = 'Bot_' + Math.floor(Math.random() * 10000);
      
      // Add bot participant directly to UI
      addParticipantToUI({
        login: name,
        display_name: name,
        profileImageUrl: null,
        luck: 0.5, // Bots have lower luck
        userId: 'bot_' + Math.floor(Math.random() * 100000),
        isBot: true
      });
    }
    
    console.log(`🤖 Added ${count} bot participants to UI`);
  }
  
  // Helper function for animated participant addition
  function addParticipantWithAnimation(participant) {
    if (!elements.participantsList) return null;
    
    const participantElement = renderParticipant(participant);
    
    // Set initial animation state (hidden and moved)
    participantElement.style.opacity = '0';
    participantElement.style.transform = 'translateX(-20px)';
    participantElement.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    
    // Add to DOM - newest participants at the top
    elements.participantsList.prepend(participantElement);
    
    // Trigger animation after DOM insertion
    setTimeout(() => {
      participantElement.style.opacity = '1';
      participantElement.style.transform = 'translateX(0)';
    }, 10); // Small delay to ensure DOM insertion
    
    return participantElement;
  }
  
  function addParticipantToUI(participant) {
    if (!elements.participantsList) return;
    
    // Check if participant already exists
    const existingParticipant = elements.participantsList.querySelector(`[data-remove="${participant.login}"]`);
    if (existingParticipant) {
      console.log('Participant already exists:', participant.login);
      return;
    }
    
    // Add with animation
    addParticipantWithAnimation(participant);
    
    // Update counters - use updateParticipantCount for accurate DOM-based count
    updateParticipantCount();
    StateManager.updateButtonStates();
    checkScrollbar();
    
    console.log('✅ Added participant to UI with animation:', participant.login);
  }
  
  function clearAllParticipantsIncludingTestAndBots() {
    if (!elements.participantsList) return;
    
    const participants = Array.from(elements.participantsList.children);
    console.log('🧹 Clearing all participants including test and bots:', participants.length);
    
    // Immediately reset counters to prevent display issues
    AppState.giveaway.entries = 0;
    StateManager.updateEntriesDisplay();
    StateManager.updateButtonStates();
    
    if (participants.length > 0) {
      // Clear all participants at once without staggered animation to prevent counter issues
      participants.forEach((participant) => {
        participant.style.opacity = '0';
        participant.style.transform = 'translateX(-20px)';
        participant.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      });
      
      // Remove all participants after animation
      setTimeout(() => {
        // Force clear the entire participants list
        elements.participantsList.innerHTML = '';
        
        // Double-check counter reset
        AppState.giveaway.entries = 0;
        StateManager.updateEntriesDisplay();
        StateManager.updateButtonStates();
        updateParticipantCount();
        
        console.log('Teilnehmerliste komplett geleert (inkl. Test-Teilnehmer und Bots)');
      }, 300);
    } else {
      // Even if no participants, ensure counter is correct
      updateParticipantCount();
    }
  }
  
  function setParticipantLuck(username, multiplier) {
    // Find participant in UI
    const participantItem = elements.participantsList?.querySelector(`[data-login="${username}"]`) ||
                           elements.participantsList?.querySelector(`[data-remove="${username}"]`) ||
                           Array.from(elements.participantsList?.querySelectorAll('.participant-row') || [])
                             .find(row => row.textContent.toLowerCase().includes(username.toLowerCase()));
    
    if (!participantItem) {
      sendAdminFeedback(`❌ Could not find ${username} in participants`, 'error');
      return;
    }
    
    // Update luck multiplier in UI
    const luckElement = participantItem.querySelector('.participant-luck');
    if (luckElement) {
      luckElement.textContent = multiplier.toFixed(1) + 'x';
      luckElement.style.color = multiplier > 1 ? 'var(--success)' : 'var(--text-primary)';
      
      // Add subtle visual feedback - only highlight text content
      luckElement.style.display = 'inline-block';
      luckElement.style.backgroundColor = 'var(--success)';
      luckElement.style.color = 'white';
      luckElement.style.borderRadius = '4px';
      luckElement.style.padding = '2px 6px';
      luckElement.style.fontWeight = 'bold';
      luckElement.style.fontSize = '0.85em';
      luckElement.style.transition = 'all 0.4s ease';
      luckElement.style.width = 'auto';
      luckElement.style.textAlign = 'center';
      
      setTimeout(() => {
        luckElement.style.display = '';
        luckElement.style.backgroundColor = '';
        luckElement.style.color = multiplier > 1 ? 'var(--success)' : 'var(--text-primary)';
        luckElement.style.borderRadius = '';
        luckElement.style.padding = '';
        luckElement.style.fontWeight = '';
        luckElement.style.fontSize = '';
        luckElement.style.width = '';
        luckElement.style.textAlign = '';
      }, 1200);
      
      sendAdminFeedback(`🍀 Set ${username} luck to ${multiplier}x`, 'success');
      console.log('🍀 Updated participant luck:', username, 'New luck:', multiplier);
    } else {
      sendAdminFeedback(`❌ Could not update luck display for ${username}`, 'error');
    }
  }
  
  function sendAdminFeedback(message, type = 'info') {
    // Show toast notification
    UIManager.showToast(message, type);
    
    // Also add message to chat for visual feedback
    const chatList = document.getElementById('chatList');
    if (chatList) {
      const color = type === 'success' ? '#00ff00' : type === 'error' ? '#ff0000' : '#ffaa00';
      const row = document.createElement('div');
      row.className = 'msg admin-msg';
      row.style.borderLeft = `3px solid ${color}`;
      row.innerHTML = `
        <div class="msg-content">
          <div class="chat-user-info">
            <span class="user" style="color:${color}">🛠️ ADMIN:</span>
          </div>
          <span class="msg-text">${message}</span>
        </div>
      `;
      
      chatList.appendChild(row);
      chatList.scrollTop = chatList.scrollHeight;
      
      // Remove admin message after 10 seconds
      setTimeout(() => {
        if (row.parentNode) row.remove();
      }, 10000);
    }
  }

  socket.on('giveaway:winner', (winner) => {
    showWinnerModal(winner);
    
    setTimeout(() => {
      clearParticipantsListAfterWinner();
    }, 1500);
  });

  socket.on('host:auto_joined', (hostParticipant) => {
    if (!elements.participantsList) return;
    console.log('Host automatisch beigetreten:', hostParticipant.login);
    console.groupEnd();
    
    const existingHost = elements.participantsList.querySelector(`[data-remove="${hostParticipant.login}"]`);
    if (!existingHost) {
      addParticipantWithAnimation(hostParticipant);
      updateParticipantCount();
      checkScrollbar();
    }
  });

  // Handler für Badge-Antwort vom Server
  socket.on('response:user-badges', (data) => {
    if (data.badges) {
      AppState.userBadges = data.badges;
      AppState.userLuck = data.luck || 1.0;
      console.log('✅ Badges via Socket empfangen:', AppState.userBadges.length, 'Badges, Luck:', AppState.userLuck);
    }
  });

  // Handler für neue Teilnehmer - cache Badges falls es der aktuelle User ist
  socket.on('participant:add', (p) => {
    console.log('Teilnehmer hinzugefügt:', p.login, 'Luck:', p.luck);
    
    // Wenn es der aktuelle User ist, cache seine Badge-Informationen
    if (AppState.user && p.login && p.login.toLowerCase() === AppState.user.login.toLowerCase()) {
      if (p.badges && p.badges.length > 0) {
        AppState.userBadges = p.badges;
        console.log('✅ Badges von Teilnehmer-Event gecacht:', AppState.userBadges.length);
      }
      if (p.luck && p.luck > 1) {
        AppState.userLuck = p.luck;
        console.log('✅ Luck von Teilnehmer-Event gecacht:', AppState.userLuck);
      }
    }
    
    AppState.giveaway.entries++;
    StateManager.updateEntriesDisplay();
    StateManager.updateButtonStates();

    if (!elements.participantsList) return;
    
    const existingParticipant = elements.participantsList.querySelector(`[data-remove="${p.login}"]`);
    if (existingParticipant) {
      console.log('Teilnehmer existiert bereits:', p.login);
      return;
    }
    
    addParticipantWithAnimation(p);
    updateParticipantCount();
    checkScrollbar();
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
        
        // Konfetti läuft automatisch aus - wird durch setTimeout in createConfetti() selbst entfernt
        
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
        
        // Konfetti läuft automatisch aus - wird durch setTimeout in createConfetti() selbst entfernt
        
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

  console.group('🎬 ZinxyBot Dashboard');
  console.log('Enhanced ZinxyBot Dashboard vollständig initialisiert mit MM:SS Zeitformat!');
  // Add event listener for emote refresh button
  const refreshEmotesBtn = document.getElementById('refreshEmotesBtn');
  if (refreshEmotesBtn) {
    refreshEmotesBtn.addEventListener('click', () => {
      EmoteAutocomplete.refreshEmotes();
    });
  }
  
  // Add event listener for emote test button
  const testEmotesBtn = document.getElementById('testEmotesBtn');
  if (testEmotesBtn) {
    testEmotesBtn.addEventListener('click', () => {
      EmoteAutocomplete.testEmoteParsing();
    });
  }
  
  // Add event listener for channel emotes button
  const channelEmotesBtn = document.getElementById('channelEmotesBtn');
  if (channelEmotesBtn) {
    channelEmotesBtn.addEventListener('click', () => {
      EmoteAutocomplete.showChannelEmotes();
    });
  }
  
  // Add event listener for refresh chat button
  const refreshChatBtn = document.getElementById('refreshChatBtn');
  if (refreshChatBtn) {
    refreshChatBtn.addEventListener('click', () => {
      refreshChat();
    });
  }
  
  
  console.log('Benutzer-Authentifizierung und Session-Isolierung aktiv');
  console.log('Timer-Ende-Bug behoben - Teilnehmer werden korrekt ausgewählt');
  console.log('MM:SS Zeitformat mit 10-Sekunden-Schritten implementiert');
  console.groupEnd();
  
  
  // Initialize admin system
  AdminSystem.init();
}

// Chat refresh function to reset the live chat when it's not working properly
function refreshChat() {
  console.group('🔄 Chat Refresh');
  console.log('Chat wird aktualisiert...');
  
  // Only show toast - no entries animation trigger
  if (typeof UIManager !== 'undefined' && UIManager.showToast) {
    UIManager.showToast('Chat cleared', 'info');
  }
  
  // Get refresh button and add animation
  const refreshBtn = document.getElementById('refreshChatBtn');
  const refreshIcon = refreshBtn?.querySelector('i');
  
  // Add spinning animation to refresh button
  if (refreshIcon) {
    refreshIcon.style.animation = 'spin 1s linear infinite';
  }
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.style.opacity = '0.5';
  }
  
  // Get chat container and animate existing messages out
  const chatList = document.getElementById('chatList');
  const existingMessages = chatList?.querySelectorAll('.msg');
  
  if (existingMessages && existingMessages.length > 0) {
    // Animate all messages out at once (same as participant removal)
    existingMessages.forEach((message) => {
      message.style.opacity = '0';
      message.style.transform = 'translateX(-20px)';
      message.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    });
    
    // Wait for animation to complete before showing empty state
    setTimeout(() => {
      // Remove all messages at once
      existingMessages.forEach(message => message.remove());
      showEmptyState();
      completeRefresh();
    }, 200);
  } else {
    // No messages to animate, proceed directly
    showEmptyState();
    setTimeout(completeRefresh, 200);
  }
  
  function showEmptyState() {
    if (chatList) {
      // Clear any remaining content
      chatList.innerHTML = '';
      
      // Add back the empty state with animation
      const emptyState = document.createElement('div');
      emptyState.className = 'empty';
      emptyState.setAttribute('role', 'status');
      emptyState.style.opacity = '0';
      emptyState.style.transform = 'translateY(10px)';
      emptyState.innerHTML = `
        <i data-lucide="message-square" aria-hidden="true"></i>
        <p>No chat messages</p>
      `;
      chatList.appendChild(emptyState);
      
      // Re-initialize the Lucide icons for the empty state
      lucide.createIcons(emptyState);
      
      // Animate empty state in
      setTimeout(() => {
        emptyState.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        emptyState.style.opacity = '1';
        emptyState.style.transform = 'translateY(0)';
      }, 50);
    }
  }
  
  function completeRefresh() {
    // Clear the message cache to prevent duplicates
    if (typeof displayedMessages !== 'undefined') {
      displayedMessages.clear();
    }
    
    // DO NOT disconnect/reconnect socket - just clear chat display
    // This prevents status flickering and giveaway disruption
    
    // Reset refresh button
    if (refreshIcon) {
      refreshIcon.style.animation = '';
    }
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.style.opacity = '';
    }
    
    // No success toast to prevent confusion
    console.log('💬 Chat display cleared (socket connection maintained)');
    
    console.log('Chat-Aktualisierung abgeschlossen');
    console.groupEnd();
  }
}

// Helper function to create participant elements for testing
function createTestParticipant(participant) {
  const login = participant.login || '';
  const display = participant.displayName || login;
  const avatar = participant.profileImageUrl;
  const luck = participant.luck || 1.0;
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
  
  const li = document.createElement('li');
  li.className = 'row participant-row';
  li.setAttribute('data-login', login);
  li.innerHTML = `
    <div class="who">
      <div class="avatar">
        ${avatarHtml}
      </div>
      <div class="participant-info">
        <div class="participant-name">
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
  `;
  
  // Initialize Lucide icons for the new element
  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    lucide.createIcons(li);
  }
  
  return li;
}

// Helper function for safe socket operations
function safeSocketEmit(eventName, data, callback) {
  if (typeof window.socket !== 'undefined' && window.socket && window.socket.connected) {
    console.log(`[Socket] Sende Event: ${eventName}`, data);
    window.socket.emit(eventName, data, callback);
    return true;
  } else {
    console.warn('Socket nicht verfügbar oder nicht verbunden. Event:', eventName);
    console.log('Socket-Status:', {
      socketExists: typeof window.socket !== 'undefined',
      socket: window.socket,
      connected: window.socket ? window.socket.connected : 'N/A'
    });
    return false;
  }
}


// Enhanced HTML escaping with additional security measures
function escapeHtml(s) {
  if (typeof s !== 'string') {
    s = String(s || '');
  }
  
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .replace(/`/g, '&#x60;')
    .replace(/=/g, '&#x3D;');
}

// Additional security function to remove dangerous attributes and scripts
function sanitizeText(text) {
  if (typeof text !== 'string') {
    return '';
  }
  
  // Remove any potential script tags or dangerous content
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/data:/gi, '')
    .replace(/vbscript:/gi, '');
}

// ===================== POPUP FLOOD SYSTEM =====================
const PopupSystem = {
  activePopups: new Set(),
  videoFiles: [
    "Creamcock's Lightest Snack Yet 💀🤤.mp4",
    "Happy.mp4",
    "Real Footage of ZinxyWinxy singing Beat It.mp4", 
    "Shape Of You.mp4",
    "Sunshine.mp4",
    "Swalla.mp4",
    "Súbeme La Radio.mp4",
    "Vibing With ZinxyWinxy Ass Emote.mp4",
    "We Need To Build ｜ 4K Edit.mp4",
    "ZinxyWinxy Lip-Syncing to Shape of You.mp4"
  ],
  recentlyUsed: [], // Track recently used videos
  maxRecentCount: 4, // How many recent videos to avoid (increased for more variety)
  isActive: false,
  endTime: 0,
  
  getRandomVideo() {
    // If we have fewer videos than maxRecentCount, just pick randomly
    if (this.videoFiles.length <= this.maxRecentCount) {
      return this.videoFiles[Math.floor(Math.random() * this.videoFiles.length)];
    }
    
    // Get videos that are NOT in the recently used list
    const availableVideos = this.videoFiles.filter(video => 
      !this.recentlyUsed.includes(video)
    );
    
    let selectedVideo;
    
    // If we have available videos, pick from those
    if (availableVideos.length > 0) {
      selectedVideo = availableVideos[Math.floor(Math.random() * availableVideos.length)];
    } else {
      // Fallback: if all videos are recently used, clear the recent list and pick any
      console.log('🔄 All videos recently used, resetting rotation');
      this.recentlyUsed = [];
      selectedVideo = this.videoFiles[Math.floor(Math.random() * this.videoFiles.length)];
    }
    
    // Add to recently used list
    this.recentlyUsed.push(selectedVideo);
    
    // Keep only the last maxRecentCount videos in the recent list
    if (this.recentlyUsed.length > this.maxRecentCount) {
      this.recentlyUsed.shift(); // Remove the oldest one
    }
    
    console.log(`🎬 Selected video: ${selectedVideo}`);
    console.log(`📝 Recently used: [${this.recentlyUsed.join(', ')}]`);
    
    return selectedVideo;
  },
  
  getResponsiveSize() {
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    
    // Base size for desktop
    let baseWidth = 420;
    let baseHeight = 320;
    
    // Scale based on screen size
    if (screenWidth <= 480) {
      // Mobile phones
      baseWidth = Math.min(screenWidth - 40, 320);
      baseHeight = Math.min(screenHeight - 80, 240);
    } else if (screenWidth <= 768) {
      // Tablets
      baseWidth = Math.min(screenWidth - 60, 380);
      baseHeight = Math.min(screenHeight - 100, 290);
    } else if (screenWidth <= 1024) {
      // Small laptops
      baseWidth = 380;
      baseHeight = 290;
    }
    // Desktop keeps original size
    
    return { width: baseWidth, height: baseHeight };
  },

  getRandomPosition() {
    const size = this.getResponsiveSize();
    const popupWidth = size.width;
    const popupHeight = size.height;
    const margin = window.innerWidth <= 768 ? 10 : 20; // Smaller margins on mobile
    
    // Calculate available area with margins
    const maxX = Math.max(0, window.innerWidth - popupWidth - margin);
    const maxY = Math.max(0, window.innerHeight - popupHeight - margin);
    
    // Generate positions with better distribution
    let x, y;
    let attempts = 0;
    const maxAttempts = 10;
    
    do {
      x = Math.max(margin, Math.floor(Math.random() * (maxX + 1)));
      y = Math.max(margin, Math.floor(Math.random() * (maxY + 1)));
      attempts++;
      
      // Check if position overlaps with existing popups (simple collision detection)
      let overlaps = false;
      for (const popupId of this.activePopups) {
        const existingPopup = document.getElementById(popupId);
        if (existingPopup) {
          const existingX = parseInt(existingPopup.style.left);
          const existingY = parseInt(existingPopup.style.top);
          
          // Adjust collision buffer based on screen size
          const buffer = window.innerWidth <= 768 ? 30 : 50;
          
          // Check for overlap with buffer
          if (Math.abs(x - existingX) < popupWidth + buffer && 
              Math.abs(y - existingY) < popupHeight + buffer) {
            overlaps = true;
            break;
          }
        }
      }
      
      if (!overlaps || attempts >= maxAttempts) {
        break;
      }
    } while (attempts < maxAttempts);
    
    return { x, y, width: popupWidth, height: popupHeight };
  },
  
  createPopup() {
    if (!this.isActive || Date.now() > this.endTime) return;
    
    const popup = document.createElement('div');
    const popupId = 'popup-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    popup.id = popupId;
    popup.className = 'virus-popup';
    
    const position = this.getRandomPosition();
    const videoFile = this.getRandomVideo();
    
    // Responsive popup sizing
    const isMobile = window.innerWidth <= 768;
    const borderRadius = isMobile ? '8px' : '10px';
    const headerHeight = isMobile ? '24px' : '28px';
    const videoHeight = position.height - (isMobile ? 40 : 44); // Subtract header and padding
    
    popup.style.cssText = `
      position: fixed;
      top: ${position.y}px;
      left: ${position.x}px;
      width: ${position.width}px;
      height: ${position.height}px;
      background: #14161a;
      border: 1px solid rgba(255,255,255,.08);
      border-radius: ${borderRadius};
      z-index: 10000;
      box-shadow: 0 8px 24px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.03);
      overflow: hidden;
      cursor: move;
      font-family: ui-sans-serif,system-ui,Segoe UI,Inter,Manrope,Arial;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      will-change: transform, opacity;
      transform: translateZ(0);
      backface-visibility: hidden;
    `;
    
    popup.innerHTML = `
      <div class="popup-header" style="
        background: #1a1d23;
        color: #e9e9f2;
        padding: ${isMobile ? '4px 6px' : '6px 8px'};
        display: flex;
        justify-content: flex-end;
        align-items: center;
        cursor: move;
        border-radius: ${borderRadius} ${borderRadius} 0 0;
        border-bottom: 1px solid rgba(255,255,255,.08);
        min-height: ${headerHeight};
      ">
        <button class="popup-close" style="
          background: #ef4444;
          color: white;
          border: none;
          width: ${isMobile ? '16px' : '18px'};
          height: ${isMobile ? '16px' : '18px'};
          border-radius: ${isMobile ? '3px' : '4px'};
          cursor: pointer;
          font-size: ${isMobile ? '9px' : '10px'};
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          touch-action: manipulation;
        " onmouseover="this.style.background='#dc2626'" onmouseout="this.style.background='#ef4444'" ontouchstart="this.style.background='#dc2626'" ontouchend="this.style.background='#ef4444'">×</button>
      </div>
      <div style="padding: ${isMobile ? '6px' : '8px'}; background: #0e0e10; border-radius: 0 0 ${borderRadius} ${borderRadius};">
        <video autoplay loop muted playsinline preload="metadata" style="
          width: 100%;
          height: ${videoHeight}px;
          object-fit: cover;
          border-radius: ${isMobile ? '4px' : '6px'};
          background: #000;
          will-change: transform;
        ">
          <source src="/assets/videos/${encodeURIComponent(videoFile)}" type="video/mp4">
        </video>
      </div>
    `;
    
    // Add entrance animation
    popup.style.opacity = '0';
    popup.style.transform = 'scale(0.8) translateY(-20px)';
    
    document.body.appendChild(popup);
    this.activePopups.add(popupId);
    
    // Trigger entrance animation
    requestAnimationFrame(() => {
      popup.style.opacity = '1';
      popup.style.transform = 'scale(1) translateY(0px)';
      
      // After animation completes, remove transform to avoid dragging conflicts
      setTimeout(() => {
        popup.style.transform = 'none';
      }, 300); // Match the transition duration
    });
    
    // Make popup draggable
    this.makeDraggable(popup);
    
    // Add subtle hover effects (shadow only, no transform to avoid dragging conflicts)
    popup.addEventListener('mouseenter', () => {
      popup.style.boxShadow = '0 12px 32px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.05), 0 0 0 1px rgba(169, 112, 255, 0.2)';
    });
    
    popup.addEventListener('mouseleave', () => {
      popup.style.boxShadow = '0 8px 24px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.03)';
    });
    
    // Optimized video loading and unmuting
    const video = popup.querySelector('video');
    
    // Set up proper video handling
    video.addEventListener('loadeddata', () => {
      // Video is ready to play
      setTimeout(() => {
        if (video && !video.muted) return; // Already unmuted
        
        video.muted = false;
        video.volume = 0.7; // Not full volume to prevent audio shock
        video.play().catch(() => {
          // Fallback if autoplay is blocked
          video.muted = true;
          video.play();
        });
      }, 100);
    }, { once: true });
    
    // Handle video errors gracefully
    video.addEventListener('error', (e) => {
      console.warn('Video failed to load:', videoFile);
      // Try to reload once
      if (!video._retried) {
        video._retried = true;
        setTimeout(() => video.load(), 1000);
      }
    });
    
    // Close button handler - but spawn more popups when closed!
    const closeBtn = popup.querySelector('.popup-close');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closePopup(popupId);
      
      // Spawn 2-4 more popups when one is closed (if still active)
      if (this.isActive && Date.now() < this.endTime) {
        const spawnCount = Math.floor(Math.random() * 3) + 2; // 2-4 popups
        for (let i = 0; i < spawnCount; i++) {
          setTimeout(() => this.createPopup(), Math.random() * 500);
        }
      }
    });
    
    // Schedule respawn after random delay (longer)
    if (this.isActive && Date.now() < this.endTime) {
      setTimeout(() => {
        if (this.activePopups.has(popupId) && this.isActive && Date.now() < this.endTime) {
          this.createPopup();
        }
      }, Math.random() * 8000 + 4000); // 4-12 seconds
    }
  },
  
  makeDraggable(popup) {
    const header = popup.querySelector('.popup-header');
    let isDragging = false;
    let startX, startY, startLeft, startTop;
    let animationFrame = null;
    
    const handleMouseDown = (e) => {
      e.preventDefault();
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = parseInt(popup.style.left);
      startTop = parseInt(popup.style.top);
      header.style.cursor = 'grabbing';
      popup.style.zIndex = '10001';
      
      // Disable transitions during drag for better performance
      popup.style.transition = 'none';
      
      // Pause video during drag to improve performance
      const video = popup.querySelector('video');
      if (video) {
        video.style.pointerEvents = 'none';
      }
      
      document.body.style.userSelect = 'none';
    };
    
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      
      // Use requestAnimationFrame for smooth dragging
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      
      animationFrame = requestAnimationFrame(() => {
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        
        // Better boundary checking with popup dimensions
        const popupWidth = 420;
        const popupHeight = 320;
        const newLeft = Math.max(0, Math.min(window.innerWidth - popupWidth, startLeft + deltaX));
        const newTop = Math.max(0, Math.min(window.innerHeight - popupHeight, startTop + deltaY));
        
        // Update position directly - no transform needed during drag
        popup.style.left = newLeft + 'px';
        popup.style.top = newTop + 'px';
      });
    };
    
    const handleMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        header.style.cursor = 'move';
        popup.style.zIndex = '10000';
        
        // Don't reset transform - keep the popup where it was dragged
        // Just re-enable transitions for future interactions
        popup.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        
        // Re-enable video interactions
        const video = popup.querySelector('video');
        if (video) {
          video.style.pointerEvents = 'auto';
        }
        
        document.body.style.userSelect = '';
        
        // Cancel any pending animation frame
        if (animationFrame) {
          cancelAnimationFrame(animationFrame);
          animationFrame = null;
        }
      }
    };
    
    // Add event listeners with passive option for better performance
    header.addEventListener('mousedown', handleMouseDown, { passive: false });
    document.addEventListener('mousemove', handleMouseMove, { passive: false });
    document.addEventListener('mouseup', handleMouseUp, { passive: true });
    document.addEventListener('mouseleave', handleMouseUp, { passive: true });
    
    // Store cleanup function for later use
    popup._dragCleanup = () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      header.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mouseleave', handleMouseUp);
    };
  },
  
  closePopup(popupId) {
    const popup = document.getElementById(popupId);
    if (popup) {
      // Clean up drag event listeners
      if (popup._dragCleanup) {
        popup._dragCleanup();
      }
      
      // Volume fade out with smooth tween
      const video = popup.querySelector('video');
      if (video && !video.muted) {
        this.fadeOutVolume(video, 300);
      }
      
      // Smooth exit animation
      popup.style.opacity = '0';
      popup.style.transform = 'scale(0.8) translateY(-20px)';
      popup.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 1, 1)';
      
      setTimeout(() => {
        if (popup.parentElement) {
          // Final cleanup
          if (video) {
            video.pause();
            video.src = '';
          }
          popup.remove();
        }
      }, 300);
      
      this.activePopups.delete(popupId);
    }
  },

  fadeOutVolume(video, duration = 300) {
    const startVolume = video.volume;
    const startTime = performance.now();
    
    const fadeOut = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Smooth easing curve
      const easeOut = 1 - Math.pow(1 - progress, 3);
      video.volume = startVolume * (1 - easeOut);
      
      if (progress < 1) {
        requestAnimationFrame(fadeOut);
      } else {
        video.volume = 0;
      }
    };
    
    requestAnimationFrame(fadeOut);
  },
  
  start(duration) {
    this.isActive = true;
    this.endTime = Date.now() + duration;
    
    // Reset video rotation at the start of each session
    this.recentlyUsed = [];
    console.log('🎯 Starting popup flood - video rotation reset');
    
    // Create initial popups faster
    for (let i = 0; i < 3; i++) {
      setTimeout(() => this.createPopup(), Math.random() * 1000 + 500); // 0.5-1.5 seconds delay
    }
    
    // Keep creating popups randomly but slower
    const spawnInterval = setInterval(() => {
      if (!this.isActive || Date.now() > this.endTime) {
        clearInterval(spawnInterval);
        return;
      }
      
      if (this.activePopups.size < 15) { // Max 15 popups at once (reduced)
        this.createPopup();
      }
    }, 800 + Math.random() * 1200); // New popup every 0.8-2.0 seconds (faster spawning)
    
    // Auto cleanup after duration
    setTimeout(() => {
      this.stop();
    }, duration);
  },
  
  stop() {
    this.isActive = false;
    
    // Reset video rotation for next session
    this.recentlyUsed = [];
    
    // Close all popups with staggered animation
    const popups = Array.from(this.activePopups);
    popups.forEach((popupId, index) => {
      setTimeout(() => {
        const popup = document.getElementById(popupId);
        if (popup) {
          // Clean up drag listeners
          if (popup._dragCleanup) {
            popup._dragCleanup();
          }
          
          // Fade out volume smoothly
          const video = popup.querySelector('video');
          if (video && !video.muted) {
            this.fadeOutVolume(video, 400);
          }
          
          popup.style.opacity = '0';
          popup.style.transform = 'scale(0.6) translateY(30px) rotate(5deg)';
          popup.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 1, 1)';
          popup.style.filter = 'blur(2px)';
          
          setTimeout(() => {
            if (popup.parentElement) {
              // Final cleanup
              if (video) {
                video.pause();
                video.src = '';
              }
              popup.remove();
            }
          }, 400);
        }
      }, index * 50); // Staggered by 50ms each
    });
    
    this.activePopups.clear();
    
    // Show completion message
    setTimeout(() => {
      console.log('🚀 Popup flood ended - all popups closed with style');
      
      // Create a subtle notification
      if (typeof UIManager !== 'undefined' && UIManager.showToast) {
        UIManager.showToast('🦠 Virus simulation ended', 'success');
      }
    }, popups.length * 50 + 500);
  },
  
  // Utility function to adjust rotation settings
  setRotationSettings(maxRecentCount) {
    this.maxRecentCount = Math.max(1, Math.min(maxRecentCount, this.videoFiles.length - 1));
    console.log(`📹 Video rotation updated: avoiding last ${this.maxRecentCount} videos`);
  },

  // Handle window resize for responsive popups
  handleResize() {
    if (!this.isActive) return;
    
    // Reposition and resize existing popups
    for (const popupId of this.activePopups) {
      const popup = document.getElementById(popupId);
      if (popup) {
        const size = this.getResponsiveSize();
        const currentX = parseInt(popup.style.left);
        const currentY = parseInt(popup.style.top);
        
        // Check if current position is still valid
        const margin = window.innerWidth <= 768 ? 10 : 20;
        const maxX = Math.max(0, window.innerWidth - size.width - margin);
        const maxY = Math.max(0, window.innerHeight - size.height - margin);
        
        // Adjust position if needed
        const newX = Math.min(currentX, maxX);
        const newY = Math.min(currentY, maxY);
        
        // Update popup size and position
        popup.style.width = size.width + 'px';
        popup.style.height = size.height + 'px';
        popup.style.left = newX + 'px';
        popup.style.top = newY + 'px';
        
        // Update video height and responsive elements
        const video = popup.querySelector('video');
        const header = popup.querySelector('.popup-header');
        const closeBtn = popup.querySelector('.popup-close');
        
        if (video) {
          const isMobile = window.innerWidth <= 768;
          const videoHeight = size.height - (isMobile ? 40 : 44);
          video.style.height = videoHeight + 'px';
          video.style.borderRadius = isMobile ? '4px' : '6px';
        }
        
        // Update header and button sizes
        if (header && closeBtn) {
          const isMobile = window.innerWidth <= 768;
          header.style.padding = isMobile ? '4px 6px' : '6px 8px';
          header.style.minHeight = isMobile ? '24px' : '28px';
          closeBtn.style.width = isMobile ? '16px' : '18px';
          closeBtn.style.height = isMobile ? '16px' : '18px';
          closeBtn.style.fontSize = isMobile ? '9px' : '10px';
        }
      }
    }
  }
};

// Add window resize listener for responsive popups
window.addEventListener('resize', () => {
  if (PopupSystem.isActive) {
    PopupSystem.handleResize();
  }
});

function startPopupFlood(duration) {
  PopupSystem.start(duration);
}

// ===================== CHAT COPY FUNCTIONALITY =====================
function getPlainTextFromMessage(chatEvent) {
  // Get the original text without HTML/emotes
  let text = chatEvent?.text || chatEvent?.message || '';
  
  // If it contains HTML, strip it out
  if (text.includes('<img') && text.includes('chat-emote')) {
    // Create a temporary div to parse HTML and extract text
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = text;
    text = tempDiv.textContent || tempDiv.innerText || '';
  }
  
  return text.trim();
}

function copyMessageToClipboard(button) {
  const message = button.getAttribute('data-message');
  
  // Use modern Clipboard API if available
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(message).then(() => {
      showCopySuccess(button);
    }).catch((err) => {
      console.error('Failed to copy message:', err);
      // Fallback to legacy method
      fallbackCopyTextToClipboard(message, button);
    });
  } else {
    // Fallback for older browsers or non-HTTPS
    fallbackCopyTextToClipboard(message, button);
  }
}

function fallbackCopyTextToClipboard(text, button) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  
  // Avoid scrolling to bottom
  textArea.style.top = '0';
  textArea.style.left = '0';
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    document.execCommand('copy');
    showCopySuccess(button);
  } catch (err) {
    console.error('Fallback: Could not copy text:', err);
    showCopyError(button);
  }
  
  document.body.removeChild(textArea);
}

function showCopySuccess(button) {
  const originalTitle = button.getAttribute('title');
  const originalIcon = button.innerHTML;
  
  button.setAttribute('title', 'Copied!');
  button.classList.add('copied');
  
  // Smooth morph animation - fade out current icon
  const currentSvg = button.querySelector('svg');
  if (currentSvg) {
    currentSvg.style.opacity = '0';
    currentSvg.style.transform = 'scale(0.8)';
    
    setTimeout(() => {
      // Replace with checkmark
      button.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="opacity: 0; transform: scale(0.8); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
      `;
      
      // Fade in new icon
      requestAnimationFrame(() => {
        const newSvg = button.querySelector('svg');
        if (newSvg) {
          newSvg.style.opacity = '1';
          newSvg.style.transform = 'scale(1)';
        }
      });
    }, 150);
  }
  
  // Reset after 1.5 seconds with same morph timing
  setTimeout(() => {
    button.setAttribute('title', originalTitle);
    button.classList.remove('copied');
    
    // Smooth morph back to original - fade out checkmark
    const checkSvg = button.querySelector('svg');
    if (checkSvg) {
      checkSvg.style.opacity = '0';
      checkSvg.style.transform = 'scale(0.8)';
      
      setTimeout(() => {
        button.innerHTML = originalIcon; // Restore original icon
        
        requestAnimationFrame(() => {
          const restoredSvg = button.querySelector('svg');
          if (restoredSvg) {
            restoredSvg.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
            restoredSvg.style.opacity = '1';
            restoredSvg.style.transform = 'scale(1)';
          }
        });
      }, 150);
    }
  }, 1500);
  
  // Show toast notification
  if (typeof UIManager !== 'undefined' && UIManager.showToast) {
    UIManager.showToast('Message copied', 'success');
  }
}

function showCopyError(button) {
  const originalTitle = button.getAttribute('title');
  const originalIcon = button.innerHTML;
  
  button.setAttribute('title', 'Copy failed');
  button.classList.add('copy-error');
  
  // Smooth morph animation - fade out current icon
  const currentSvg = button.querySelector('svg');
  if (currentSvg) {
    currentSvg.style.opacity = '0';
    currentSvg.style.transform = 'scale(0.8)';
    
    setTimeout(() => {
      // Replace icon with error symbol
      button.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="opacity: 0; transform: scale(0.8); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      `;
      
      // Fade in new icon
      requestAnimationFrame(() => {
        const newSvg = button.querySelector('svg');
        if (newSvg) {
          newSvg.style.opacity = '1';
          newSvg.style.transform = 'scale(1)';
        }
      });
    }, 150);
  }
  
  setTimeout(() => {
    button.setAttribute('title', originalTitle);
    button.classList.remove('copy-error');
    
    // Smooth morph back to original - fade out error icon
    const errorSvg = button.querySelector('svg');
    if (errorSvg) {
      errorSvg.style.opacity = '0';
      errorSvg.style.transform = 'scale(0.8)';
      
      setTimeout(() => {
        button.innerHTML = originalIcon; // Restore original icon
        
        requestAnimationFrame(() => {
          const restoredSvg = button.querySelector('svg');
          if (restoredSvg) {
            restoredSvg.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
            restoredSvg.style.opacity = '1';
            restoredSvg.style.transform = 'scale(1)';
          }
        });
      }, 150);
    }
  }, 1500);
}
