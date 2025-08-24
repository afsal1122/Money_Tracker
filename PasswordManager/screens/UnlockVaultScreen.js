import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert, TouchableOpacity, ActivityIndicator } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Buffer } from 'buffer';
import * as LocalAuthentication from 'expo-local-authentication';
import { deriveKey, decrypt } from '../services/crypto-service';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function UnlockVaultScreen({ onVaultUnlocked }) {
  const [masterPassword, setMasterPassword] = useState('');
  const [loading, setLoading] = useState(true);

  // This useEffect runs once when the screen loads to attempt biometric unlock
  useEffect(() => {
    const tryBiometricUnlock = async () => {
      const isBiometricsAvailable = await LocalAuthentication.hasHardwareAsync() && await LocalAuthentication.isEnrolledAsync();
      const storedKeyBase64 = await SecureStore.getItemAsync('biometric_key');

      if (isBiometricsAvailable && storedKeyBase64) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Unlock your vault',
        });

        if (result.success) {
          const key = Buffer.from(storedKeyBase64, 'base64');
          const encryptedVault = await SecureStore.getItemAsync('user_vault');
          const vault = decrypt(encryptedVault, key);
          if (vault) {
            onVaultUnlocked(key, vault);
          } else {
            // This case is rare, but could happen if vault is corrupted
            Alert.alert('Error', 'Biometric unlock failed. Please use your Master Password.');
            setLoading(false);
          }
        } else {
          setLoading(false); // Biometric failed, allow manual password entry
        }
      } else {
        setLoading(false); // No biometrics available, allow manual entry
      }
    };

    tryBiometricUnlock();
  }, []);

  const handlePasswordUnlock = async () => {
    try {
      const saltBase64 = await SecureStore.getItemAsync('user_salt');
      const encryptedVault = await SecureStore.getItemAsync('user_vault');

      if (!saltBase64 || !encryptedVault) {
        Alert.alert('Error', 'No vault found on this device.');
        return;
      }
      
      const salt = Buffer.from(saltBase64, 'base64');
      const key = await deriveKey(masterPassword, salt);
      const vault = decrypt(encryptedVault, key);

      if (vault === null) {
        Alert.alert('Error', 'Invalid Master Password.');
      } else {
        // Ask to set up biometrics after successful password unlock
        promptEnableBiometrics(key);
        onVaultUnlocked(key, vault);
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'An unexpected error occurred.');
    }
  };
  
  const promptEnableBiometrics = async (key) => {
    const isBiometricsAvailable = await LocalAuthentication.hasHardwareAsync() && await LocalAuthentication.isEnrolledAsync();
    // Only prompt if biometrics are available and a key isn't already stored
    const storedKey = await SecureStore.getItemAsync('biometric_key');

    if (isBiometricsAvailable && !storedKey) {
      Alert.alert(
        'Enable Biometric Unlock?',
        'Would you like to use Face ID / Touch ID to unlock your vault in the future?',
        [
          { text: 'No', style: 'cancel' },
          {
            text: 'Yes',
            onPress: async () => {
              const keyBase64 = Buffer.from(key).toString('base64');
              await SecureStore.setItemAsync('biometric_key', keyBase64);
              Alert.alert('Success', 'Biometric unlock has been enabled.');
            },
          },
        ]
      );
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Checking for biometrics...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MaterialCommunityIcons name="shield-lock" size={64} color="#007AFF" />
      <Text style={styles.title}>Unlock Vault</Text>
      <TextInput
        style={styles.input}
        placeholder="Master Password"
        secureTextEntry
        value={masterPassword}
        onChangeText={setMasterPassword}
      />
      <Button title="Unlock" onPress={handlePasswordUnlock} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#f5f5f7' },
  title: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginVertical: 20 },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: 'white',
    padding: 15,
    marginBottom: 20,
    borderRadius: 10,
  },
  loadingText: {
    marginTop: 10,
    color: 'gray',
  },
});