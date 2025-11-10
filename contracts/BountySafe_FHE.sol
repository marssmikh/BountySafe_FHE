pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract BountySafe_FHE is ZamaEthereumConfig {
    
    struct Bounty {
        string title;                    
        euint32 encryptedEvidence;        
        uint256 rewardAmount;             
        uint256 submissionCount;          
        string description;               
        address creator;                 
        uint256 timestamp;               
        uint32 decryptedEvidence; 
        bool isClaimed; 
    }
    
    mapping(string => Bounty) public bounties;
    mapping(string => mapping(address => bool)) public hasClaimed;
    
    string[] public bountyIds;
    
    event BountyCreated(string indexed bountyId, address indexed creator);
    event EvidenceSubmitted(string indexed bountyId, address indexed submitter);
    event BountyClaimed(string indexed bountyId, address indexed claimant);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function createBounty(
        string calldata bountyId,
        string calldata title,
        uint256 rewardAmount,
        string calldata description
    ) external {
        require(bytes(bounties[bountyId].title).length == 0, "Bounty already exists");
        
        bounties[bountyId] = Bounty({
            title: title,
            encryptedEvidence: euint32(0),
            rewardAmount: rewardAmount,
            submissionCount: 0,
            description: description,
            creator: msg.sender,
            timestamp: block.timestamp,
            decryptedEvidence: 0,
            isClaimed: false
        });
        
        bountyIds.push(bountyId);
        
        emit BountyCreated(bountyId, msg.sender);
    }
    
    function submitEvidence(
        string calldata bountyId,
        externalEuint32 encryptedEvidence,
        bytes calldata inputProof
    ) external {
        require(bytes(bounties[bountyId].title).length > 0, "Bounty does not exist");
        require(!bounties[bountyId].isClaimed, "Bounty already claimed");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedEvidence, inputProof)), "Invalid encrypted evidence");
        
        bounties[bountyId].encryptedEvidence = FHE.fromExternal(encryptedEvidence, inputProof);
        bounties[bountyId].submissionCount++;
        
        FHE.allowThis(bounties[bountyId].encryptedEvidence);
        FHE.makePubliclyDecryptable(bounties[bountyId].encryptedEvidence);
        
        emit EvidenceSubmitted(bountyId, msg.sender);
    }
    
    function verifyEvidence(
        string calldata bountyId, 
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(bounties[bountyId].title).length > 0, "Bounty does not exist");
        require(!bounties[bountyId].isClaimed, "Bounty already claimed");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(bounties[bountyId].encryptedEvidence);
        
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        bounties[bountyId].decryptedEvidence = decodedValue;
    }
    
    function claimBounty(string calldata bountyId) external {
        require(bytes(bounties[bountyId].title).length > 0, "Bounty does not exist");
        require(!bounties[bountyId].isClaimed, "Bounty already claimed");
        require(!hasClaimed[bountyId][msg.sender], "Already claimed by this address");
        
        hasClaimed[bountyId][msg.sender] = true;
        bounties[bountyId].isClaimed = true;
        
        payable(msg.sender).transfer(bounties[bountyId].rewardAmount);
        
        emit BountyClaimed(bountyId, msg.sender);
    }
    
    function getEncryptedEvidence(string calldata bountyId) external view returns (euint32) {
        require(bytes(bounties[bountyId].title).length > 0, "Bounty does not exist");
        return bounties[bountyId].encryptedEvidence;
    }
    
    function getBountyDetails(string calldata bountyId) external view returns (
        string memory title,
        uint256 rewardAmount,
        uint256 submissionCount,
        string memory description,
        address creator,
        uint256 timestamp,
        bool isClaimed,
        uint32 decryptedEvidence
    ) {
        require(bytes(bounties[bountyId].title).length > 0, "Bounty does not exist");
        Bounty storage bounty = bounties[bountyId];
        
        return (
            bounty.title,
            bounty.rewardAmount,
            bounty.submissionCount,
            bounty.description,
            bounty.creator,
            bounty.timestamp,
            bounty.isClaimed,
            bounty.decryptedEvidence
        );
    }
    
    function getAllBountyIds() external view returns (string[] memory) {
        return bountyIds;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}

