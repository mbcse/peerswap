'use client';

import { useState, useEffect } from 'react';
import { SelfQRcodeWrapper, SelfAppBuilder, type SelfApp } from '@selfxyz/qrcode';
import { Button } from '~/components/ui/Button';

interface SelfVerificationProps {
  onVerified: (proofData: any) => void;
  onSkip?: () => void;
  title?: string;
  description?: string;
  requireVerification?: boolean;
}

export function SelfVerification({
  onVerified,
  onSkip,
  title = "Identity Verification",
  description = "Verify your identity to proceed with the swap",
  requireVerification = false
}: SelfVerificationProps) {
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationComplete, setVerificationComplete] = useState(false);
  const [selfApp, setSelfApp] = useState<SelfApp | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    // Check if user is already verified for this session
    const cachedVerification = sessionStorage.getItem('self_verification_proof');
    if (cachedVerification) {
      setVerificationComplete(true);
      onVerified(JSON.parse(cachedVerification));
    }
  }, [onVerified]);

  const startVerification = async () => {
    try {
      setIsVerifying(true);
      setError('');

      // Configure Self verification with mock passport support
      const app = new SelfAppBuilder({
        version: 2,
        appName: process.env.NEXT_PUBLIC_SELF_APP_NAME || "PeerSwap",
        scope: process.env.NEXT_PUBLIC_SELF_SCOPE || "peerswap-identity-verification",
        endpoint: process.env.NEXT_PUBLIC_SELF_ENDPOINT || `${window.location.origin}/api/self-callback`,
        userId: "0x0000000000000000000000000000000000000000", // Use zero address for testing
        endpointType: "staging_https", // Use staging for mock passport testing
        userIdType: "hex",
        userDefinedData: "PeerSwap Identity Verification",
        mockPassport: process.env.NEXT_PUBLIC_SELF_MOCK_PASSPORT === 'true', // Enable mock passport for testing
        disclosures: {
          minimumAge: 18,
          nationality: true,
          gender: true,
          documentNumber: true,
          issuingCountry: true,
          documentType: true,
          givenNames: true,
          familyName: true,
        }
      });

      setSelfApp(app);

    } catch (err) {
      console.error('❌ Error starting Self verification:', err);
      setError('Failed to start verification. Please try again.');
      setIsVerifying(false);
    }
  };

  // Handle successful verification
  const handleVerified = async (proofData: any) => {
    console.log('✅ Self verification completed:', proofData);

    // Cache verification for this session
    sessionStorage.setItem('self_verification_proof', JSON.stringify(proofData));

    // Store verification on backend (optional - for demo purposes)
    try {
      const response = await fetch('/api/verify-identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proofData,
          userAddress: (window as any).ethereum?.selectedAddress || 'unknown'
        })
      });

      if (response.ok) {
        console.log('✅ Verification stored on backend');
      }
    } catch (err) {
      console.warn('⚠️ Failed to store verification on backend:', err);
      // Don't fail the verification process if backend storage fails
    }

    setVerificationComplete(true);
    setIsVerifying(false);
    onVerified(proofData);
  };

  // Handle verification error
  const handleError = (error: any) => {
    console.error('❌ Self verification error:', error);
    setError('Verification failed. Please try again.');
    setIsVerifying(false);
  };

  if (verificationComplete) {
    return (
      <div className="card p-6 bg-green-50 border-green-200">
        <div className="text-center">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-green-800 mb-2">Identity Verified</h3>
          <p className="text-sm text-green-700">Your identity has been successfully verified for this session.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-6 border-blue-200 bg-blue-50">
      <div className="text-center">
        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <h3 className="text-lg font-semibold text-blue-800 mb-2">{title}</h3>
        <p className="text-sm text-blue-700 mb-4">{description}</p>

        {!isVerifying && !selfApp && (
          <div className="space-y-3">
            <Button
              onClick={startVerification}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              Start Identity Verification
            </Button>

            {!requireVerification && onSkip && (
              <Button
                onClick={onSkip}
                className="w-full bg-gray-500 hover:bg-gray-600 text-white"
              >
                Skip Verification (Continue Without)
              </Button>
            )}
          </div>
        )}

        {isVerifying && selfApp && (
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-lg inline-block">
              <SelfQRcodeWrapper
                app={selfApp}
                onVerified={handleVerified}
                onError={handleError}
                width={192}
                height={192}
              />
            </div>
            <div className="text-sm text-blue-700">
              <p className="font-medium mb-2">Scan with Self Mobile App:</p>
              <ol className="text-left space-y-1 max-w-sm mx-auto">
                <li>1. Open the Self app on your phone</li>
                <li>2. <strong>For testing:</strong> Tap 5 times on the Self icon to create a mock passport</li>
                <li>3. Scan this QR code</li>
                <li>4. Follow the verification steps with your mock passport</li>
                <li>5. Return here when complete</li>
              </ol>
              <div className="mt-3 p-2 bg-yellow-100 border border-yellow-300 rounded text-yellow-800 text-xs">
                <strong>Testing Mode:</strong> Mock passport verification is enabled
              </div>
            </div>

            {!requireVerification && onSkip && (
              <Button
                onClick={onSkip}
                className="w-full bg-gray-500 hover:bg-gray-600 text-white"
              >
                Skip Verification
              </Button>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-100 border border-red-300 rounded-md">
            <p className="text-sm text-red-700">{error}</p>
            <Button
              onClick={startVerification}
              className="mt-2 bg-red-600 hover:bg-red-700 text-white text-sm"
            >
              Try Again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}