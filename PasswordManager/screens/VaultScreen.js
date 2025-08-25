import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Button, FlatList, StyleSheet, Modal, TextInput, Alert, TouchableOpacity, Image, Animated } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Clipboard from 'expo-clipboard';
import { encrypt } from '../services/crypto-service';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';

// --- NEW SWIPEABLE PASSWORD ITEM COMPONENT ---
const PasswordItem = ({ item, onCopyToClipboard, onEdit, onDelete }) => {
  const faviconUrl = `https://www.google.com/s2/favicons?sz=64&domain_url=${item.site}`;
  const swipeableRef = useRef(null);

  // This function renders the buttons that are revealed on swipe
  const renderRightActions = (progress, dragX) => {
    const trans = dragX.interpolate({
      inputRange: [-160, 0],
      outputRange: [0, 160],
      extrapolate: 'clamp',
    });
    return (
      <Animated.View style={{ flexDirection: 'row', width: 160, transform: [{ translateX: trans }] }}>
        <TouchableOpacity
          style={[styles.swipeButton, styles.editButton]}
          onPress={() => {
            onEdit(item);
            swipeableRef.current?.close();
          }}
        >
          <MaterialCommunityIcons name="pencil" size={24} color="white" />
          <Text style={styles.swipeButtonText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.swipeButton, styles.deleteButton]}
          onPress={() => {
            // We pass the whole ref to the delete handler so it can close the swipeable
            onDelete(item.id, swipeableRef);
          }}
        >
          <MaterialCommunityIcons name="delete" size={24} color="white" />
          <Text style={styles.swipeButtonText}>Delete</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <Swipeable ref={swipeableRef} renderRightActions={renderRightActions} overshootRight={false}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Image source={{ uri: faviconUrl }} style={styles.favicon} />
          <View>
            <Text style={styles.cardSite}>{item.site}</Text>
            {item.folder && <Text style={styles.cardFolder}>Folder: {item.folder}</Text>}
          </View>
        </View>
        <View style={styles.cardBody}>
          <View style={styles.credentialRow}>
            <Text style={styles.credentialText}>Username: {item.username}</Text>
            <TouchableOpacity onPress={() => onCopyToClipboard(item.username, 'Username')}>
              <MaterialCommunityIcons name="content-copy" size={24} color="#007AFF" />
            </TouchableOpacity>
          </View>
          <View style={styles.credentialRow}>
            <Text style={styles.credentialText}>Password: ••••••••</Text>
            <TouchableOpacity onPress={() => onCopyToClipboard(item.password, 'Password')}>
              <MaterialCommunityIcons name="content-copy" size={24} color="#007AFF" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Swipeable>
  );
};

// --- MAIN VAULT SCREEN COMPONENT (with new logic) ---
export default function VaultScreen({ sessionData, onLogout }) {
  const [vault, setVault] = useState(sessionData.vault);
  const [modalVisible, setModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredPasswords, setFilteredPasswords] = useState(vault.passwords || []);
  
  // State for tracking if we are editing an existing item
  const [editingItemId, setEditingItemId] = useState(null);

  const [newSite, setNewSite] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFolder, setNewFolder] = useState('');
  
  useEffect(() => {
    // Search logic remains the same
    if (searchQuery === '') {
      setFilteredPasswords(vault.passwords || []);
    } else {
      const filtered = (vault.passwords || []).filter(item =>
        item.site.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.folder && item.folder.toLowerCase().includes(searchQuery.toLowerCase()))
      );
      setFilteredPasswords(filtered);
    }
  }, [searchQuery, vault]);

  const saveVault = async (updatedVault) => {
    try {
      const encryptedVault = encrypt(updatedVault, sessionData.key);
      await SecureStore.setItemAsync('user_vault', encryptedVault);
      setVault(updatedVault);
    } catch (error) {
      console.error('Failed to save vault:', error);
      Alert.alert('Error', 'Could not save changes.');
    }
  };

  // --- NEW HANDLER FOR DELETING A PASSWORD ---
  const handleDeletePassword = (id, swipeableRef) => {
    Alert.alert(
      'Delete Password',
      'Are you sure you want to permanently delete this credential?',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => swipeableRef.current?.close() },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const updatedPasswords = (vault.passwords || []).filter(item => item.id !== id);
            const updatedVault = { ...vault, passwords: updatedPasswords };
            saveVault(updatedVault);
          },
        },
      ]
    );
  };

  // --- NEW HANDLER TO START THE EDITING PROCESS ---
  const handleStartEdit = (item) => {
    setEditingItemId(item.id);
    setNewSite(item.site);
    setNewUsername(item.username);
    setNewPassword(item.password);
    setNewFolder(item.folder || '');
    setModalVisible(true);
  };

  // --- MODIFIED HANDLER TO SAVE BOTH NEW AND EDITED PASSWORDS ---
  const handleSavePassword = () => {
    if (!newSite || !newUsername || !newPassword) {
      Alert.alert('Error', 'Site, Username, and Password are required.');
      return;
    }

    let updatedPasswords;

    if (editingItemId) {
      // We are editing an existing item
      updatedPasswords = (vault.passwords || []).map(item =>
        item.id === editingItemId
          ? { ...item, site: newSite, username: newUsername, password: newPassword, folder: newFolder }
          : item
      );
    } else {
      // We are adding a new item
      const newEntry = {
        id: Date.now().toString(),
        site: newSite,
        username: newUsername,
        password: newPassword,
        folder: newFolder,
      };
      updatedPasswords = [...(vault.passwords || []), newEntry];
    }
    
    const updatedVault = { ...vault, passwords: updatedPasswords };
    saveVault(updatedVault);
    resetModalState();
  };

  const resetModalState = () => {
    setModalVisible(false);
    setEditingItemId(null);
    setNewSite('');
    setNewUsername('');
    setNewPassword('');
    setNewFolder('');
  };

  const handleCopyToClipboard = async (text, type) => {
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied!', `${type} copied to clipboard.`);
  };

  return (
    <View style={styles.container}>
      {/* Header and SearchBar are unchanged */}
      <View style={styles.header}>
        <Text style={styles.title}>Your Vault</Text>
        <Button title="Logout" onPress={onLogout} color="red" />
      </View>
      <TextInput
        style={styles.searchBar}
        placeholder="Search by site, username, or folder..."
        value={searchQuery}
        onChangeText={setSearchQuery}
      />
      
      <FlatList
        data={filteredPasswords}
        keyExtractor={(item) => item.id}
        // Pass the new handlers down to the PasswordItem component
        renderItem={({ item }) => (
          <PasswordItem
            item={item}
            onCopyToClipboard={handleCopyToClipboard}
            onEdit={handleStartEdit}
            onDelete={handleDeletePassword}
          />
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No passwords found.</Text>}
        contentContainerStyle={{ paddingBottom: 100 }}
      />

      <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)}>
        <MaterialCommunityIcons name="plus" size={30} color="white" />
      </TouchableOpacity>
      
      <Modal visible={modalVisible} animationType="slide">
        <View style={styles.modalView}>
          {/* Modal title is now dynamic */}
          <Text style={styles.modalTitle}>{editingItemId ? 'Edit Credential' : 'Add New Credential'}</Text>
          <TextInput placeholder="Site (e.g., google.com)" style={styles.input} value={newSite} onChangeText={setNewSite} />
          <TextInput placeholder="Username" style={styles.input} value={newUsername} onChangeText={setNewUsername} />
          <TextInput placeholder="Password" style={styles.input} value={newPassword} onChangeText={setNewPassword} />
          <TextInput placeholder="Folder (e.g., Work, Social) - Optional" style={styles.input} value={newFolder} onChangeText={setNewFolder} />
          <Button title="Save" onPress={handleSavePassword} />
          <View style={{marginTop: 10}}>
            <Button title="Cancel" onPress={resetModalState} color="gray" />
          </View>
        </View>
      </Modal>
    </View>
  );
}

// --- STYLES (with new styles for swipe buttons) ---
const styles = StyleSheet.create({
  // ... (all existing styles are the same)
  container: { flex: 1, paddingTop: 50, paddingHorizontal: 20, backgroundColor: '#f5f5f7' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 28, fontWeight: 'bold' },
  searchBar: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    fontSize: 16,
  },
  emptyText: { textAlign: 'center', marginTop: 50, color: 'gray', fontSize: 16 },
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 30,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
  },
  modalView: { flex: 1, justifyContent: 'center', padding: 20 },
  modalTitle: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
  input: { borderWidth: 1, borderColor: 'gray', backgroundColor: 'white', padding: 15, marginBottom: 15, borderRadius: 10 },
  card: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 10,
    marginBottom: 10,
  },
  favicon: { width: 32, height: 32, marginRight: 15 },
  cardSite: { fontSize: 18, fontWeight: 'bold' },
  cardFolder: { fontSize: 12, color: 'gray' },
  cardBody: {},
  credentialRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
  },
  credentialText: { fontSize: 16 },
  // --- NEW STYLES ---
  swipeButton: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    flex: 1,
  },
  swipeButtonText: {
    color: 'white',
    fontWeight: 'bold',
    marginTop: 4,
  },
  editButton: {
    backgroundColor: '#007AFF', // Blue
  },
  deleteButton: {
    backgroundColor: '#FF3B30', // Red
  },
});