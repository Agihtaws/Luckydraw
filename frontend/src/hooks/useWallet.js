// src/hooks/useWallet.js
// Handles MetaMask connection and Somnia testnet switching.

import { useState, useEffect, useCallback } from "react";
import { createWalletClient, custom } from "viem";
import { somniaTestnet } from "../chain.js";

const SOMNIA_CHAIN_ID = "0xC488"; // 50312 in hex

export function useWallet() {
  const [address,    setAddress]    = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error,      setError]      = useState(null);

  // Restore session on load
  useEffect(() => {
    if (!window.ethereum) return;
    window.ethereum
      .request({ method: "eth_accounts" })
      .then((accounts) => { if (accounts[0]) setAddress(accounts[0]); })
      .catch(() => {});

    // Listen for account changes
    const onAccountsChanged = (accounts) => setAddress(accounts[0] || null);
    const onChainChanged    = ()          => window.location.reload();

    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged",    onChainChanged);
    return () => {
      window.ethereum.removeListener("accountsChanged", onAccountsChanged);
      window.ethereum.removeListener("chainChanged",    onChainChanged);
    };
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError("MetaMask not installed. Please install it to continue.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      // Request accounts
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });

      // Switch to Somnia testnet — add it if not already in MetaMask
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: SOMNIA_CHAIN_ID }],
        });
      } catch (switchErr) {
        // Chain not added yet — add it
        if (switchErr.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId:         SOMNIA_CHAIN_ID,
              chainName:       "Somnia Testnet",
              nativeCurrency:  { name: "STT", symbol: "STT", decimals: 18 },
              rpcUrls:         ["https://dream-rpc.somnia.network"],
              blockExplorerUrls: ["https://shannon-explorer.somnia.network"],
            }],
          });
        } else {
          throw switchErr;
        }
      }

      setAddress(accounts[0]);
    } catch (err) {
      setError(err.message || "Connection failed");
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => setAddress(null), []);

  // Returns a wallet client for sending transactions
  const getWalletClient = useCallback(() => {
    if (!window.ethereum || !address) return null;
    return createWalletClient({
      account:   address,
      chain:     somniaTestnet,
      transport: custom(window.ethereum),
    });
  }, [address]);

  return { address, connecting, error, connect, disconnect, getWalletClient };
}