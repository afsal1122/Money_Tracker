// crypto-service.js - CORRECTED VERSION WITH POLYFILL FIRST
import 'react-native-get-random-values'; // MUST BE THE VERY FIRST IMPORT
import nacl from 'tweetnacl';
import { Buffer } from 'buffer'; // Needed for Base64 conversions

// Helper function to convert strings to Uint8Array and back
const toUint8Array = (str) => Buffer.from(str, 'utf8');
const fromUint8Array = (arr) => Buffer.from(arr).toString('utf8');

// NOTE: tweetnacl does not have a built-in KDF like Argon2.
// For a production app, you would add a library like 'scrypt-js' here.
// For simplicity in this educational project, we will derive the key
// in a simple (but still secure for this context) way. A proper KDF is a crucial
// hardening step for a real product.
export const deriveKey = async (password, salt) => {
  // This is a simplified key derivation. In a real app, use a proper KDF library.
  const passwordBytes = toUint8Array(password);
  const saltBytes = toUint8Array(salt);
  
  // A simple way to combine them for key derivation. Not as slow as Argon2.
  const combined = new Uint8Array(passwordBytes.length + saltBytes.length);
  combined.set(passwordBytes);
  combined.set(saltBytes, passwordBytes.length);

  // Use a standard hash function to create a key of the correct length (32 bytes)
  return nacl.hash(combined).slice(0, nacl.secretbox.keyLength);
};

// Function to encrypt data (our vault)
export const encrypt = (data, key) => {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const jsonString = JSON.stringify(data);
  const dataBytes = toUint8Array(jsonString);

  const ciphertext = nacl.secretbox(dataBytes, nonce, key);

  // Combine nonce and ciphertext to store together
  const fullMessage = new Uint8Array(nonce.length + ciphertext.length);
  fullMessage.set(nonce);
  fullMessage.set(ciphertext, nonce.length);

  // Return as a Base64 string for easy storage
  return Buffer.from(fullMessage).toString('base64');
};

// Function to decrypt data
export const decrypt = (encryptedBase64, key) => {
  try {
    const fullMessage = Buffer.from(encryptedBase64, 'base64');
    
    const nonce = fullMessage.slice(0, nacl.secretbox.nonceLength);
    const ciphertext = fullMessage.slice(nacl.secretbox.nonceLength);

    const decryptedBytes = nacl.secretbox.open(ciphertext, nonce, key);
    
    if (!decryptedBytes) {
      throw new Error("Decryption failed! Ciphertext could not be authenticated.");
    }

    const jsonString = fromUint8Array(decryptedBytes);
    return JSON.parse(jsonString);
  } catch (error) {
    // This will fail if the key is wrong or data is corrupt
    console.error("Decryption failed!", error);
    return null;
  }
};

// Helper to generate a new salt (using a simpler method for this library)
export const generateSalt = () => {
  // For this simplified KDF, we just need a random string as a salt.
  // We'll encode random bytes as a base64 string.
  const randomBytes = nacl.randomBytes(16);
  return Buffer.from(randomBytes).toString('base64');
};