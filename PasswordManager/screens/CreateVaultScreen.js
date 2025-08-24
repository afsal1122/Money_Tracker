import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Buffer } from 'buffer';
import { generateSalt, deriveKey, encrypt } from '../services/crypto-service';

export default function CreateVaultScreen({ onVaultCreated }) {
  const [masterPassword, setMasterPassword] = useState('');

  const handleCreateVault = async () => {
    if (masterPassword.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters long.');
      return;
    }
    try {
      const salt = generateSalt();
      const key = await deriveKey(masterPassword, salt);
      
      const emptyVault = { passwords: [] };
      const encryptedVault = encrypt(emptyVault, key);
      
      const saltBase64 = Buffer.from(salt).toString('base64');
      
      await SecureStore.setItemAsync('user_salt', saltBase64);
      await SecureStore.setItemAsync('user_vault', encryptedVault);
      
      onVaultCreated(key, emptyVault);
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to create vault.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create Your Secure Vault</Text>
      <Text style={styles.subtitle}>Choose a strong Master Password. This password is NEVER stored anywhere. If you forget it, your data is lost forever.</Text>
      <TextInput
        style={styles.input}
        placeholder="Master Password"
        secureTextEntry
        value={masterPassword}
        onChangeText={setMasterPassword}
      />
      <Button title="Create Vault" onPress={handleCreateVault} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 10 },
  subtitle: { textAlign: 'center', marginBottom: 20, color: 'gray' },
  input: {
    borderWidth: 1,
    borderColor: 'gray',
    padding: 10,
    marginBottom: 20,
    borderRadius: 5,
  },
});