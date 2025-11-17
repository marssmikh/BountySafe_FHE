import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface BountyData {
  id: string;
  title: string;
  description: string;
  encryptedReward: string;
  publicValue1: number;
  publicValue2: number;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
  status: 'active' | 'completed' | 'pending';
  category: string;
}

interface UserHistory {
  action: string;
  bountyId: string;
  timestamp: number;
  details: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [bounties, setBounties] = useState<BountyData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingBounty, setCreatingBounty] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newBountyData, setNewBountyData] = useState({ 
    title: "", 
    description: "", 
    reward: "", 
    category: "security" 
  });
  const [selectedBounty, setSelectedBounty] = useState<BountyData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [userHistory, setUserHistory] = useState<UserHistory[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    completed: 0,
    totalRewards: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [contractAddress, setContractAddress] = useState("");

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadBounties();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadBounties = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const bountiesList: BountyData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          bountiesList.push({
            id: businessId,
            title: businessData.name,
            description: businessData.description,
            encryptedReward: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            status: businessData.isVerified ? 'completed' : 'active',
            category: "security"
          });
        } catch (e) {
          console.error('Error loading bounty data:', e);
        }
      }
      
      setBounties(bountiesList);
      updateStats(bountiesList);
      if (address) loadUserHistory(bountiesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (bountiesList: BountyData[]) => {
    const total = bountiesList.length;
    const active = bountiesList.filter(b => b.status === 'active').length;
    const completed = bountiesList.filter(b => b.status === 'completed').length;
    const totalRewards = bountiesList.reduce((sum, b) => sum + (b.decryptedValue || 0), 0);
    
    setStats({ total, active, completed, totalRewards });
  };

  const loadUserHistory = (bountiesList: BountyData[]) => {
    if (!address) return;
    
    const userBounties = bountiesList.filter(b => b.creator.toLowerCase() === address.toLowerCase());
    const history: UserHistory[] = userBounties.map(bounty => ({
      action: 'created',
      bountyId: bounty.id,
      timestamp: bounty.timestamp,
      details: `Created "${bounty.title}"`
    }));
    
    setUserHistory(history.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10));
  };

  const createBounty = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingBounty(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted bounty..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const rewardValue = parseInt(newBountyData.reward) || 0;
      const businessId = `bounty-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, rewardValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newBountyData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        rewardValue,
        0,
        newBountyData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Bounty created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadBounties();
      setShowCreateModal(false);
      setNewBountyData({ title: "", description: "", reward: "", category: "security" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingBounty(false); 
    }
  };

  const decryptBounty = async (bountyId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(bountyId);
      if (businessData.isVerified) {
        return Number(businessData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(bountyId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(bountyId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadBounties();
      
      setTransactionStatus({ visible: true, status: "success", message: "Bounty verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        await loadBounties();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: `Contract is available: ${isAvailable}` 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredBounties = bounties.filter(bounty => {
    const matchesSearch = bounty.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         bounty.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === "all" || bounty.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>BountySafe FHE 🔐</h1>
            <p>隱私懸賞舉報平台</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🛡️</div>
            <h2>Connect Wallet to Access Secure Bounty System</h2>
            <p>Anonymous whistleblower platform with FHE encryption</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet securely</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system initializes automatically</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Create or participate in encrypted bounties</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your bounty data</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading secure bounty platform...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>BountySafe FHE 🔐</h1>
          <p>隱私懸賞舉報 · 公益平台</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="status-btn">
            Check Status
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Bounty
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panels">
          <div className="stat-panel">
            <div className="stat-icon">💰</div>
            <div className="stat-info">
              <div className="stat-value">{stats.total}</div>
              <div className="stat-label">Total Bounties</div>
            </div>
          </div>
          
          <div className="stat-panel">
            <div className="stat-icon">⚡</div>
            <div className="stat-info">
              <div className="stat-value">{stats.active}</div>
              <div className="stat-label">Active</div>
            </div>
          </div>
          
          <div className="stat-panel">
            <div className="stat-icon">✅</div>
            <div className="stat-info">
              <div className="stat-value">{stats.completed}</div>
              <div className="stat-label">Completed</div>
            </div>
          </div>
          
          <div className="stat-panel">
            <div className="stat-icon">🏆</div>
            <div className="stat-info">
              <div className="stat-value">{stats.totalRewards}</div>
              <div className="stat-label">Total Rewards</div>
            </div>
          </div>
        </div>

        <div className="content-grid">
          <div className="main-panel">
            <div className="panel-header">
              <h2>Active Bounties</h2>
              <div className="controls">
                <div className="search-box">
                  <input 
                    type="text" 
                    placeholder="Search bounties..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <select 
                  value={filterCategory} 
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="filter-select"
                >
                  <option value="all">All Categories</option>
                  <option value="security">Security</option>
                  <option value="governance">Governance</option>
                  <option value="compliance">Compliance</option>
                </select>
                <button onClick={loadBounties} className="refresh-btn">
                  🔄
                </button>
              </div>
            </div>
            
            <div className="bounties-list">
              {filteredBounties.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">🔍</div>
                  <p>No bounties found</p>
                  <button onClick={() => setShowCreateModal(true)} className="create-btn">
                    Create First Bounty
                  </button>
                </div>
              ) : (
                filteredBounties.map((bounty) => (
                  <div 
                    key={bounty.id}
                    className={`bounty-item ${bounty.status}`}
                    onClick={() => setSelectedBounty(bounty)}
                  >
                    <div className="bounty-header">
                      <h3>{bounty.title}</h3>
                      <span className={`status-badge ${bounty.status}`}>
                        {bounty.status}
                      </span>
                    </div>
                    <p className="bounty-desc">{bounty.description}</p>
                    <div className="bounty-meta">
                      <span>Reward: {bounty.isVerified ? `${bounty.decryptedValue} ETH` : '🔒 Encrypted'}</span>
                      <span>{new Date(bounty.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="bounty-creator">
                      Creator: {bounty.creator.substring(0, 8)}...
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="side-panel">
            <div className="user-history">
              <h3>Your Activity</h3>
              {userHistory.length === 0 ? (
                <p className="no-history">No recent activity</p>
              ) : (
                userHistory.map((record, index) => (
                  <div key={index} className="history-item">
                    <div className="history-action">{record.action}</div>
                    <div className="history-details">{record.details}</div>
                    <div className="history-time">
                      {new Date(record.timestamp * 1000).toLocaleString()}
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div className="fhe-info-panel">
              <h3>FHE Protection 🔐</h3>
              <div className="fhe-step">
                <div className="step-number">1</div>
                <div className="step-content">
                  <strong>Encrypt Bounty</strong>
                  <p>Reward amount encrypted with FHE</p>
                </div>
              </div>
              <div className="fhe-step">
                <div className="step-number">2</div>
                <div className="step-content">
                  <strong>Submit Evidence</strong>
                  <p>Whistleblowers submit encrypted evidence</p>
                </div>
              </div>
              <div className="fhe-step">
                <div className="step-number">3</div>
                <div className="step-content">
                  <strong>Verify & Reward</strong>
                  <p>Automatic verification and payout</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showCreateModal && (
        <CreateBountyModal 
          onSubmit={createBounty}
          onClose={() => setShowCreateModal(false)}
          creating={creatingBounty}
          bountyData={newBountyData}
          setBountyData={setNewBountyData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedBounty && (
        <BountyDetailModal 
          bounty={selectedBounty}
          onClose={() => setSelectedBounty(null)}
          onDecrypt={() => decryptBounty(selectedBounty.id)}
          isDecrypting={fheIsDecrypting}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            {transactionStatus.status === "success" && <div className="toast-icon">✓</div>}
            {transactionStatus.status === "error" && <div className="toast-icon">✗</div>}
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const CreateBountyModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  bountyData: any;
  setBountyData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, bountyData, setBountyData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'reward') {
      const intValue = value.replace(/[^\d]/g, '');
      setBountyData({ ...bountyData, [name]: intValue });
    } else {
      setBountyData({ ...bountyData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>Create New Bounty</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE Encrypted Bounty 🔐</strong>
            <p>Reward amount will be encrypted using Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Bounty Title *</label>
            <input
              type="text"
              name="title"
              value={bountyData.title}
              onChange={handleChange}
              placeholder="Enter bounty title..."
            />
          </div>
          
          <div className="form-group">
            <label>Description *</label>
            <textarea
              name="description"
              value={bountyData.description}
              onChange={handleChange}
              placeholder="Describe the bounty details..."
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Reward Amount (ETH) *</label>
            <input
              type="number"
              name="reward"
              value={bountyData.reward}
              onChange={handleChange}
              placeholder="Enter reward amount..."
              min="0"
              step="1"
            />
            <div className="input-hint">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Category</label>
            <select name="category" value={bountyData.category} onChange={handleChange}>
              <option value="security">Security</option>
              <option value="governance">Governance</option>
              <option value="compliance">Compliance</option>
            </select>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button
            onClick={onSubmit}
            disabled={creating || isEncrypting || !bountyData.title || !bountyData.description || !bountyData.reward}
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Bounty"}
          </button>
        </div>
      </div>
    </div>
  );
};

const BountyDetailModal: React.FC<{
  bounty: BountyData;
  onClose: () => void;
  onDecrypt: () => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ bounty, onClose, onDecrypt, isDecrypting }) => {
  const handleDecrypt = async () => {
    await onDecrypt();
  };

  return (
    <div className="modal-overlay">
      <div className="modal large">
        <div className="modal-header">
          <h2>Bounty Details</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="bounty-info-grid">
            <div className="info-section">
              <h3>{bounty.title}</h3>
              <p>{bounty.description}</p>
              
              <div className="info-grid">
                <div className="info-item">
                  <label>Status</label>
                  <span className={`status ${bounty.status}`}>{bounty.status}</span>
                </div>
                <div className="info-item">
                  <label>Creator</label>
                  <span>{bounty.creator}</span>
                </div>
                <div className="info-item">
                  <label>Created</label>
                  <span>{new Date(bounty.timestamp * 1000).toLocaleString()}</span>
                </div>
                <div className="info-item">
                  <label>Category</label>
                  <span>{bounty.category}</span>
                </div>
              </div>
            </div>
            
            <div className="reward-section">
              <h3>Reward Information</h3>
              <div className="reward-display">
                <div className="reward-amount">
                  {bounty.isVerified ? (
                    <>
                      <div className="decrypted-value">{bounty.decryptedValue} ETH</div>
                      <div className="verification-badge verified">✅ Verified</div>
                    </>
                  ) : (
                    <>
                      <div className="encrypted-value">🔒 Encrypted</div>
                      <div className="verification-badge pending">Pending Verification</div>
                    </>
                  )}
                </div>
                
                <button
                  onClick={handleDecrypt}
                  disabled={isDecrypting || bounty.isVerified}
                  className={`decrypt-btn ${bounty.isVerified ? 'verified' : ''}`}
                >
                  {isDecrypting ? 'Decrypting...' : 
                   bounty.isVerified ? 'Verified' : 'Verify Reward'}
                </button>
              </div>
              
              <div className="fhe-explanation">
                <h4>FHE Protection Process</h4>
                <p>Reward amount is encrypted on-chain using Fully Homomorphic Encryption. 
                Verification requires offline decryption and on-chain proof submission.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!bounty.isVerified && (
            <button
              onClick={handleDecrypt}
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? 'Verifying...' : 'Verify on-chain'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

