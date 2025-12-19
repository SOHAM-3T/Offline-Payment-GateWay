let bankApiUrl = 'http://localhost:4000';

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupEventHandlers();
  loadConfig();
  loadData();
  setInterval(loadData, 5000); // Auto-refresh every 5 seconds
});

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  const contents = document.querySelectorAll('.tab-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      document.getElementById(`${targetTab}-tab`).classList.add('active');
      
      loadData();
    });
  });
}

function setupEventHandlers() {
  document.getElementById('save-config').addEventListener('click', () => {
    bankApiUrl = document.getElementById('bank-api-url').value;
    localStorage.setItem('bank_api_url', bankApiUrl);
    alert('Configuration saved!');
    loadData();
  });
  
  document.getElementById('settle-btn').addEventListener('click', async () => {
    const file = document.getElementById('ledger-file').files[0];
    if (!file) {
      alert('Please select a ledger file');
      return;
    }
    
    try {
      const text = await file.text();
      const ledgerData = JSON.parse(text);
      await settleLedger(ledgerData);
    } catch (err) {
      showMessage('settlement-result', 'Error: ' + err.message, 'error');
    }
  });
}

function loadConfig() {
  const stored = localStorage.getItem('bank_api_url');
  if (stored) {
    bankApiUrl = stored;
    document.getElementById('bank-api-url').value = bankApiUrl;
  }
}

async function loadData() {
  await loadKYC();
  await loadWallets();
  await loadLogs();
}

async function loadKYC() {
  try {
    const response = await fetch(`${bankApiUrl}/kyc/users?kyc_status=pending`);
    if (!response.ok) throw new Error('Failed to load KYC');
    
    const users = await response.json();
    const listDiv = document.getElementById('kyc-list');
    
    if (users.length === 0) {
      listDiv.innerHTML = '<p style="color: #999; padding: 20px;">No pending KYC registrations</p>';
      return;
    }
    
    listDiv.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email/Phone</th>
            <th>Bank ID</th>
            <th>Role</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(user => `
            <tr>
              <td>${user.full_name}</td>
              <td>${user.email_or_phone}</td>
              <td>${user.bank_id}</td>
              <td>${user.role}</td>
              <td><span class="status-badge ${user.kyc_status}">${user.kyc_status}</span></td>
              <td>
                <button class="btn btn-success" onclick="approveKYC('${user.user_id}', true)">Approve</button>
                <button class="btn btn-danger" onclick="approveKYC('${user.user_id}', false)" style="margin-left: 5px;">Reject</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    document.getElementById('kyc-list').innerHTML = `<p style="color: #dc3545;">Error: ${err.message}</p>`;
  }
}

async function approveKYC(userId, approve) {
  try {
    const response = await fetch(`${bankApiUrl}/kyc/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        kyc_status: approve ? 'approved' : 'rejected',
        notes: approve ? 'Approved by admin' : 'Rejected by admin'
      })
    });
    
    if (!response.ok) throw new Error('Failed to approve KYC');
    
    alert(`KYC ${approve ? 'approved' : 'rejected'} successfully`);
    loadKYC();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function loadWallets() {
  try {
    // Get all wallets and filter pending ones
    const response = await fetch(`${bankApiUrl}/kyc/users`);
    if (!response.ok) throw new Error('Failed to load wallets');
    
    const users = await response.json();
    const listDiv = document.getElementById('wallets-list');
    const pendingWallets = [];
    
    for (const user of users) {
      if (user.kyc_status === 'approved') {
        try {
          const walletResponse = await fetch(`${bankApiUrl}/wallets/user/${user.user_id}`);
          if (walletResponse.ok) {
            const wallet = await walletResponse.json();
            if (wallet.status === 'pending') {
              pendingWallets.push({ ...wallet, user });
            }
          }
        } catch (e) {
          console.error('Error loading wallet for user', user.user_id, e);
        }
      }
    }
    
    if (pendingWallets.length === 0) {
      listDiv.innerHTML = '<p style="color: #999; padding: 20px;">No pending wallet requests</p>';
      return;
    }
    
    listDiv.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>User</th>
            <th>Bank ID</th>
            <th>Requested Limit</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${pendingWallets.map(wallet => `
            <tr>
              <td>${wallet.user.full_name}</td>
              <td>${wallet.user.bank_id}</td>
              <td>₹${wallet.approved_limit}</td>
              <td><span class="status-badge ${wallet.status}">${wallet.status}</span></td>
              <td>
                <button class="btn btn-success" onclick="approveWallet('${wallet.wallet_id}', ${wallet.approved_limit}, true)">Approve</button>
                <button class="btn btn-danger" onclick="approveWallet('${wallet.wallet_id}', 0, false)" style="margin-left: 5px;">Reject</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    document.getElementById('wallets-list').innerHTML = `<p style="color: #dc3545;">Error: ${err.message}</p>`;
  }
}

async function approveWallet(walletId, limit, approve) {
  try {
    const response = await fetch(`${bankApiUrl}/wallets/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet_id: walletId,
        approved_limit: limit,
        status: approve ? 'approved' : 'rejected',
        notes: approve ? 'Approved by admin' : 'Rejected by admin'
      })
    });
    
    if (!response.ok) throw new Error('Failed to approve wallet');
    
    alert(`Wallet ${approve ? 'approved' : 'rejected'} successfully`);
    loadWallets();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function settleLedger(ledgerData) {
  const btn = document.getElementById('settle-btn');
  btn.disabled = true;
  btn.textContent = 'Processing...';
  
  try {
    const response = await fetch(`${bankApiUrl}/settle-ledger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ledgerData)
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Settlement failed');
    }
    
    const result = await response.json();
    showMessage('settlement-result', 
      `Settlement ${result.settled ? 'successful' : 'failed'}. ` +
      `Settled ${result.settled_transactions.length} transactions. ` +
      (result.errors.length > 0 ? `Errors: ${result.errors.join(', ')}` : ''),
      result.settled ? 'success' : 'error'
    );
    
  } catch (err) {
    showMessage('settlement-result', 'Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verify & Settle';
    document.getElementById('ledger-file').value = '';
  }
}

async function loadLogs() {
  try {
    const response = await fetch(`${bankApiUrl}/bank-logs?limit=50`);
    if (!response.ok) throw new Error('Failed to load logs');
    
    const data = await response.json();
    const logs = data.logs || [];
    const listDiv = document.getElementById('logs-list');
    
    if (logs.length === 0) {
      listDiv.innerHTML = '<p style="color: #999; padding: 20px;">No logs available</p>';
      return;
    }
    
    listDiv.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Status</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          ${logs.map(log => `
            <tr>
              <td>${new Date(log.timestamp).toLocaleString()}</td>
              <td>${log.actor}</td>
              <td>${log.action}</td>
              <td><span class="status-badge ${log.status}">${log.status}</span></td>
              <td><small>${JSON.stringify(log.details).substring(0, 100)}</small></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    document.getElementById('logs-list').innerHTML = `<p style="color: #dc3545;">Error: ${err.message}</p>`;
  }
}

function showMessage(elementId, text, type) {
  const element = document.getElementById(elementId);
  element.innerHTML = `<div class="message ${type}">${text}</div>`;
  setTimeout(() => {
    element.innerHTML = '';
  }, 10000);
}

// Make functions available globally for onclick handlers
window.approveKYC = approveKYC;
window.approveWallet = approveWallet;

