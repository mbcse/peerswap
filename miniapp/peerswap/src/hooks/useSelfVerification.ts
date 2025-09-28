'use client';

import { useState, useEffect } from 'react';

interface VerificationData {
  proof: any;
  timestamp: number;
  userAddress?: string;
}

export function useSelfVerification(userAddress?: string) {
  const [isVerified, setIsVerified] = useState(false);
  const [verificationData, setVerificationData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkVerificationStatus();
  }, [userAddress]);

  const checkVerificationStatus = () => {
    try {
      // Check session storage for verification
      const cachedVerification = sessionStorage.getItem('self_verification_proof');

      if (cachedVerification) {
        const data: VerificationData = JSON.parse(cachedVerification);

        // Check if verification is recent (24 hours) and for current user
        const isRecent = Date.now() - data.timestamp < 24 * 60 * 60 * 1000;
        const isCurrentUser = !userAddress || data.userAddress === userAddress;

        if (isRecent && isCurrentUser) {
          setIsVerified(true);
          setVerificationData(data.proof);
        } else {
          // Clear expired or different user verification
          sessionStorage.removeItem('self_verification_proof');
        }
      }
    } catch (error) {
      console.error('Error checking verification status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const setVerification = (proofData: any) => {
    const verificationData: VerificationData = {
      proof: proofData,
      timestamp: Date.now(),
      userAddress
    };

    sessionStorage.setItem('self_verification_proof', JSON.stringify(verificationData));
    setIsVerified(true);
    setVerificationData(proofData);
  };

  const clearVerification = () => {
    sessionStorage.removeItem('self_verification_proof');
    setIsVerified(false);
    setVerificationData(null);
  };

  return {
    isVerified,
    verificationData,
    isLoading,
    setVerification,
    clearVerification,
    checkVerificationStatus
  };
}