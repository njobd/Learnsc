// app.js — extracted from index.html inline <script>
// All original app logic: auth, chat, friends, UI state.
// This file is loaded as a regular script (not a module) because it
// uses window.supabase set by src/main.js (the module entry point).
// Load order in index.html: src/main.js (module) → app.js (defer)

// Function to get supabase client safely
function getSupabaseClient() {
    if (!window.supabase) {
        console.error("Supabase client not initialized yet");
        return null;
    }
    return window.supabase;
}

// Application State
let currentUser = null;
let currentChat = null;
let activeTab = "chats";
let friends = [];
let conversations = [];
let tempMessages = new Map(); // Local cache of temp messages
let permanentMessages = new Map(); // Local cache of permanent messages
let pendingMessages = new Map(); // Local pending messages (local echo)
let realtimeChannel = null;
let isRealtimeConnected = false;
let localMessageIdCounter = 0;

// Utility functions
function showNotification(message, type = "success") {
    const notification = document.createElement("div");
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3000);
}

function updateRealtimeStatus(connected) {
    isRealtimeConnected = connected;
    const statusElements =
        document.querySelectorAll(".realtime-status");
    statusElements.forEach((el) => {
        el.classList.toggle("disconnected", !connected);

        // Clear existing content safely
        while (el.firstChild) {
            el.removeChild(el.firstChild);
        }

        // Create status dot
        const statusDot = document.createElement("span");
        statusDot.className = "status-dot";
        el.appendChild(statusDot);

        // Add text content
        el.appendChild(
            document.createTextNode(connected ? "Live" : "Offline"),
        );
    });
}

function generateLocalMessageId() {
    return `local_${Date.now()}_${++localMessageIdCounter}`;
}

// Real-time functions
function setupRealtimeSubscription() {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        console.error(
            "Cannot setup realtime - Supabase client not available",
        );
        return;
    }

    if (realtimeChannel) {
        supabaseClient.removeChannel(realtimeChannel);
    }

    realtimeChannel = supabaseClient
        .channel("chat_channel")
        .on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: "temp_messages",
            },
            handleNewTempMessage,
        )
        .on(
            "postgres_changes",
            {
                event: "DELETE",
                schema: "public",
                table: "temp_messages",
            },
            handleDeletedTempMessage,
        )
        .on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: "messages",
            },
            handleNewPermanentMessage,
        )
        .subscribe((status) => {
            updateRealtimeStatus(status === "SUBSCRIBED");
            if (status === "SUBSCRIBED") {
                console.log("Real-time subscription active");
            } else if (status === "CHANNEL_ERROR") {
                console.error("Real-time subscription error");
                updateRealtimeStatus(false);
            }
        });
}

function isMessageRelevantToUser(message) {
    return (
        message.sender_id === currentUser.id ||
        message.receiver_id === currentUser.id
    );
}

function handleNewTempMessage(payload) {
    const message = payload.new;

    // Only process messages relevant to current user
    if (!isMessageRelevantToUser(message)) return;

    // Remove from pending messages if this was a local echo
    if (message.sender_id === currentUser.id) {
        const chatKey = [message.sender_id, message.receiver_id]
            .sort()
            .join("-");
        const pending = pendingMessages.get(chatKey) || [];
        const updatedPending = pending.filter(
            (p) =>
                p.content !== message.content ||
                Math.abs(
                    new Date(p.created_at) -
                        new Date(message.created_at),
                ) > 5000,
        );

        if (updatedPending.length !== pending.length) {
            pendingMessages.set(chatKey, updatedPending);
        }
    }

    // Add to local cache
    const chatKey = [message.sender_id, message.receiver_id]
        .sort()
        .join("-");
    if (!tempMessages.has(chatKey)) {
        tempMessages.set(chatKey, []);
    }
    tempMessages.get(chatKey).push(message);

    // Mark as seen if receiver is viewing this chat
    if (
        currentChat &&
        message.receiver_id === currentUser.id &&
        message.sender_id === currentChat.friendId
    ) {
        markTempMessageAsSeen(message.id);
    }

    // Update UI if this chat is currently open
    if (
        currentChat &&
        (message.sender_id === currentChat.friendId ||
            message.receiver_id === currentChat.friendId)
    ) {
        renderCombinedMessages();
        updateSaveIndicator(currentChat.friendId);
    }

    // Update conversations list
    updateAllConversations();
}

function handleDeletedTempMessage(payload) {
    const message = payload.old;

    // Only process messages relevant to current user
    if (!isMessageRelevantToUser(message)) return;

    // Remove from local cache
    const chatKey = [message.sender_id, message.receiver_id]
        .sort()
        .join("-");

    if (tempMessages.has(chatKey)) {
        const messages = tempMessages.get(chatKey);
        const index = messages.findIndex(
            (msg) => msg.id === message.id,
        );
        if (index !== -1) {
            messages.splice(index, 1);
        }

        if (messages.length === 0) {
            tempMessages.delete(chatKey);
        }
    }

    // Update UI if this chat is currently open
    if (
        currentChat &&
        (message.sender_id === currentChat.friendId ||
            message.receiver_id === currentChat.friendId)
    ) {
        renderCombinedMessages();
        updateSaveIndicator(currentChat.friendId);
    }

    updateAllConversations();
}

function handleNewPermanentMessage(payload) {
    const message = payload.new;

    // Only process messages relevant to current user
    if (!isMessageRelevantToUser(message)) return;

    // Add to local cache
    const chatKey = [message.sender_id, message.receiver_id]
        .sort()
        .join("-");
    if (!permanentMessages.has(chatKey)) {
        permanentMessages.set(chatKey, []);
    }
    permanentMessages.get(chatKey).push(message);

    // Update UI if this chat is currently open
    if (
        currentChat &&
        (message.sender_id === currentChat.friendId ||
            message.receiver_id === currentChat.friendId)
    ) {
        renderCombinedMessages();
    }

    // Update conversations list
    updateAllConversations();
}

async function markTempMessageAsSeen(messageId) {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) return;

        await supabaseClient.rpc("mark_temp_message_seen", {
            _message_id: messageId,
            _user_id: currentUser.id,
        });
    } catch (err) {
        console.error("Mark message as seen error:", err);
    }
}

// Authentication functions
async function handleRegister(e) {
    e.preventDefault();
    const username = document
        .getElementById("registerUsername")
        .value.trim();
    const password =
        document.getElementById("registerPassword").value;

    if (!username || !password) {
        showNotification("Please fill in all fields", "error");
        return;
    }

    if (username.length < 3) {
        showNotification(
            "Username must be at least 3 characters long",
            "error",
        );
        return;
    }

    if (password.length < 6) {
        showNotification(
            "Password must be at least 6 characters long",
            "error",
        );
        return;
    }

    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            showNotification(
                "Connection not ready. Please try again.",
                "error",
            );
            return;
        }

        const { data, error } = await supabaseClient.rpc(
            "register_user",
            {
                _username: username,
                _password: password,
            },
        );

        if (error) {
            if (error.message.includes("username_exists")) {
                showNotification(
                    "Username already taken. Please choose a different username.",
                    "error",
                );
            } else {
                showNotification(
                    `Registration failed: ${error.message}`,
                    "error",
                );
            }
            return;
        }

        if (data && data.length > 0) {
            const userDisplayId = data[0].display_id;
showNotification(`Registration successful! Your user ID is: ${userDisplayId}`, false);
            document.getElementById("registerForm").reset();
            showLogin();
        } else {
            showNotification(
                "Registration failed. Please try again.",
                "error",
            );
        }
    } catch (err) {
        console.error("Registration error:", err);
        showNotification(
            `Registration error: ${err.message}`,
            "error",
        );
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document
        .getElementById("loginUsername")
        .value.trim();
    const password = document.getElementById("loginPassword").value;

    if (!username || !password) {
        showNotification("Please fill in all fields", "error");
        return;
    }

    try {
        const supabaseClient = getSupabaseClient();
        console.log("Attempting login for username:", username);
        console.log("Supabase client available:", !!supabaseClient);

        if (!supabaseClient) {
            showNotification(
                "Connection not ready. Please try again.",
                "error",
            );
            return;
        }

        const { data, error } = await supabaseClient.rpc(
            "login_user",
            {
                _username: username,
                _password: password,
            },
        );

        console.log(
            "Login response - data:",
            data,
            "error:",
            error,
        );

        if (error) {
            console.error("Login RPC error:", error);
            showNotification(
                `Login failed: ${error.message}`,
                "error",
            );
            return;
        }

        if (!data || data.length === 0) {
            console.log("No data returned from login_user RPC");
            showNotification(
                "Invalid username or password.",
                "error",
            );
            return;
        }

        currentUser = {
            id: data[0].id,
            name: data[0].username,
            displayId: data[0].display_id,
            created_at: data[0].created_at,
        };

        console.log("Login successful for user:", currentUser);
        showApp();
        setupRealtimeSubscription();
        showNotification(`Welcome back, ${currentUser.name}!`);
        document.getElementById("loginForm").reset();
    } catch (err) {
        console.error("Login error details:", err);
        showNotification(`Login failed: ${err.message}`, "error");
    }
}

function showLogin() {
    document.getElementById("registerForm").classList.add("hidden");
    document.getElementById("loginForm").classList.remove("hidden");
}

function showApp() {
    document.getElementById("authContainer").style.display = "none";
    document.getElementById("appContainer").style.display = "block";
    document.getElementById("userName").textContent =
        currentUser.name;
    document.getElementById("userId").textContent =
        currentUser.displayId;
    document.getElementById("userAvatar").textContent =
        currentUser.name.charAt(0).toUpperCase();

    loadFriends();
    loadLatestConversations();
}

function logout() {
    // Cleanup real-time subscription
    if (realtimeChannel) {
        const supabaseClient = getSupabaseClient();
        if (supabaseClient) {
            supabaseClient.removeChannel(realtimeChannel);
        }
        realtimeChannel = null;
    }

    // Reset state
    currentUser = null;
    currentChat = null;
    tempMessages.clear();
    permanentMessages.clear();
    pendingMessages.clear();
    friends = [];
    conversations = [];
    isRealtimeConnected = false;

    document.getElementById("authContainer").style.display = "flex";
    document.getElementById("appContainer").style.display = "none";
    document.getElementById("loginForm").reset();
    document.getElementById("registerForm").reset();
    showLogin();
}

// Friends management
async function loadFriends() {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) return;

        const { data, error } = await supabaseClient.rpc(
            "get_friends",
            {
                _user_id: currentUser.id,
            },
        );
        if (error) {
            console.error("Load friends error:", error);
            return;
        }
        friends = data || [];
        renderFriendsUI();
    } catch (err) {
        console.error("Load friends error:", err);
    }
}

async function addFriend(e) {
    e.preventDefault();
    const friendDisplayId = document
        .getElementById("friendUsername")
        .value.trim()
        .toUpperCase();

    if (!friendDisplayId) {
        showNotification(
            "Please enter a friend's user ID",
            "error",
        );
        return;
    }

    if (!/^[A-Z0-9]{6}$/.test(friendDisplayId)) {
        showNotification(
            "Please enter a valid 6-character user ID",
            "error",
        );
        document.getElementById("friendUsername").value = "";
        return;
    }

    if (friendDisplayId === currentUser.displayId) {
        showNotification(
            "You cannot add yourself as a friend",
            "error",
        );
        document.getElementById("friendUsername").value = "";
        return;
    }

    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            showNotification(
                "Connection not ready. Please try again.",
                "error",
            );
            return;
        }

        // Find user by display ID
        const { data: friendData, error: findError } =
            await supabaseClient.rpc("find_user_by_display_id", {
                _display_id: friendDisplayId,
            });

        if (findError || !friendData || friendData.length === 0) {
            showNotification(
                "User not found. Please check the user ID.",
                "error",
            );
            document.getElementById("friendUsername").value = "";
            return;
        }

        const friendId = friendData[0].id;

        // Check if already friends
        const isAlreadyFriend = friends.some(
            (friend) => friend.friend_id === friendId,
        );
        if (isAlreadyFriend) {
            showNotification(
                "You are already friends with this user.",
                "error",
            );
            document.getElementById("friendUsername").value = "";
            return;
        }

        // Add friend
        const { error } = await supabaseClient.rpc("add_friend", {
            _user_id: currentUser.id,
            _friend_id: friendId,
        });

        if (error) {
            console.error("Add friend error:", error);
            showNotification("Failed to add friend.", "error");
            return;
        }

        document.getElementById("friendUsername").value = "";
        loadFriends();
        showNotification(`Added ${friendData[0].username} as a friend!`, false);
    } catch (err) {
        console.error("Add friend error:", err);
        showNotification("Failed to add friend", "error");
    }
}

async function removeFriend(friendId) {
    const friend = friends.find((f) => f.friend_id === friendId);
    if (!friend) return;

    if (
        !confirm(
            `Are you sure you want to remove ${friend.friend_name} as a friend?`,
        )
    ) {
        return;
    }

    try {
        // Cleanup temp messages before removing friend
        await cleanupTempMessages(friendId);

        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            showNotification(
                "Connection not ready. Please try again.",
                "error",
            );
            return;
        }

        const { error } = await supabaseClient.rpc(
            "remove_friend",
            {
                _user_id: currentUser.id,
                _friend_id: friendId,
            },
        );
        if (error) {
            console.error("Remove friend error:", error);
            showNotification("Failed to remove friend", "error");
            return;
        }

        loadFriends();
        loadLatestConversations();

        // Close chat if it's with the removed friend
        if (currentChat && currentChat.friendId === friendId) {
            const chatContent =
                document.getElementById("chatContent");
            // Clear existing content safely
            while (chatContent.firstChild) {
                chatContent.removeChild(chatContent.firstChild);
            }

            // Create empty state elements
            const emptyState = document.createElement("div");
            emptyState.className = "empty-state";

            const emptyIcon = document.createElement("div");
            emptyIcon.className = "empty-icon";
            emptyIcon.textContent = "💬";

            const emptyTitle = document.createElement("h3");
            emptyTitle.textContent =
                "Select a chat to start messaging";

            const emptyText = document.createElement("p");
            emptyText.textContent =
                "Choose a conversation from the sidebar";

            emptyState.appendChild(emptyIcon);
            emptyState.appendChild(emptyTitle);
            emptyState.appendChild(emptyText);
            chatContent.appendChild(emptyState);
            currentChat = null;
            document.body.classList.remove("chat-open");
        }

        showNotification("Friend removed successfully", false);
    } catch (err) {
        console.error("Remove friend error:", err);
        showNotification("Failed to remove friend", "error");
    }
}

// Message functions
function getTempMessages(friendId) {
    const chatKey = [currentUser.id, friendId].sort().join("-");
    return tempMessages.get(chatKey) || [];
}

function getPermanentMessages(friendId) {
    const chatKey = [currentUser.id, friendId].sort().join("-");
    return permanentMessages.get(chatKey) || [];
}

function getPendingMessages(friendId) {
    const chatKey = [currentUser.id, friendId].sort().join("-");
    return pendingMessages.get(chatKey) || [];
}

function getCombinedMessages(friendId) {
    const temp = getTempMessages(friendId);
    const permanent = getPermanentMessages(friendId);
    const pending = getPendingMessages(friendId);

    // Combine all messages and sort by created_at
    const allMessages = [...temp, ...permanent, ...pending];
    return allMessages.sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at),
    );
}

async function sendTempMessage(e) {
    e.preventDefault();
    const messageInput = document.getElementById("messageInput");
    const content = messageInput.value.trim();

    if (!content || !currentChat) return;

    // Create local echo message
    const localId = generateLocalMessageId();
    const pendingMessage = {
        id: localId,
        local_id: localId,
        sender_id: currentUser.id,
        receiver_id: currentChat.friendId,
        content: content,
        created_at: new Date().toISOString(),
        is_pending: true,
    };

    // Add to pending messages for immediate UI update
    const chatKey = [currentUser.id, currentChat.friendId]
        .sort()
        .join("-");
    if (!pendingMessages.has(chatKey)) {
        pendingMessages.set(chatKey, []);
    }
    pendingMessages.get(chatKey).push(pendingMessage);

    // Clear input and update UI immediately
    messageInput.value = "";
    renderCombinedMessages();

    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            // Remove pending message on error
            const pending = pendingMessages.get(chatKey) || [];
            const filtered = pending.filter(
                (msg) => msg.local_id !== localId,
            );
            pendingMessages.set(chatKey, filtered);
            renderCombinedMessages();
            showNotification(
                "Connection not ready. Please try again.",
                "error",
            );
            return;
        }

        const { data, error } = await supabaseClient.rpc(
            "send_temp_message",
            {
                _sender_id: currentUser.id,
                _receiver_id: currentChat.friendId,
                _content: content,
            },
        );

        if (error) {
            // Remove pending message on error
            const pending = pendingMessages.get(chatKey) || [];
            const filtered = pending.filter(
                (msg) => msg.local_id !== localId,
            );
            pendingMessages.set(chatKey, filtered);
            renderCombinedMessages();

            console.error("Send temp message error:", error);
            if (error.message.includes("Users are not friends")) {
                showNotification(
                    "Cannot send message: Users are not friends",
                    "error",
                );
            } else {
                showNotification("Failed to send message", "error");
            }
            return;
        }

        // Message sent successfully - the real-time subscription will handle the actual message
        // Remove the pending message
        const pending = pendingMessages.get(chatKey) || [];
        const filtered = pending.filter(
            (msg) => msg.local_id !== localId,
        );
        pendingMessages.set(chatKey, filtered);

        updateSaveIndicator(currentChat.friendId);
        updateAllConversations();
    } catch (err) {
        // Remove pending message on error
        const pending = pendingMessages.get(chatKey) || [];
        const filtered = pending.filter(
            (msg) => msg.local_id !== localId,
        );
        pendingMessages.set(chatKey, filtered);
        renderCombinedMessages();

        console.error("Send temp message error:", err);
        showNotification("Failed to send message", "error");
    }
}

async function loadTempMessages(friendId) {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            console.error(
                "Supabase client not available for loading temp messages",
            );
            return;
        }

        const { data, error } = await supabaseClient.rpc(
            "get_temp_messages_between",
            {
                _user_id: currentUser.id,
                _friend_id: friendId,
            },
        );

        if (error) {
            console.error("Load temp messages error:", error);
            return;
        }

        const chatKey = [currentUser.id, friendId].sort().join("-");
        tempMessages.set(chatKey, data || []);

        // Mark unseen messages as seen
        const unseenMessages = (data || []).filter(
            (msg) =>
                msg.receiver_id === currentUser.id &&
                !msg.seen_by_receiver,
        );

        for (const msg of unseenMessages) {
            markTempMessageAsSeen(msg.id);
        }

        renderCombinedMessages();
        updateSaveIndicator(friendId);
    } catch (err) {
        console.error("Load temp messages error:", err);
    }
}

async function loadPermanentMessages(friendId) {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            console.error(
                "Supabase client not available for loading permanent messages",
            );
            return;
        }

        const { data, error } = await supabaseClient.rpc(
            "get_messages_between",
            {
                _user_id: currentUser.id,
                _friend_id: friendId,
            },
        );

        if (error) {
            console.error("Load permanent messages error:", error);
            return;
        }

        const chatKey = [currentUser.id, friendId].sort().join("-");
        permanentMessages.set(chatKey, data || []);
        renderCombinedMessages();
    } catch (err) {
        console.error("Load permanent messages error:", err);
    }
}
async function loadLatestConversations() {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            console.error(
                "Supabase client not available for loading conversations",
            );
            return;
        }

        const { data, error } = await supabaseClient.rpc(
            "get_latest_conversations",
            {
                _user_id: currentUser.id,
            },
        );

        if (error) {
            console.error("Load conversations error:", error);
            return;
        }

        conversations = data || [];
        renderConversationsUI();
    } catch (err) {
        console.error("Load conversations error:", err);
    }
}

async function saveTempMessagesToPermanent(friendId) {
    const currentTempMessages = getTempMessages(friendId);

    if (currentTempMessages.length === 0) {
        showNotification("No temporary messages to save");
        return;
    }

    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            showNotification(
                "Connection not ready. Please try again.",
                "error",
            );
            return;
        }

        const { data, error } = await supabaseClient.rpc(
            "save_temp_messages_to_permanent",
            {
                _user_id: currentUser.id,
                _friend_id: friendId,
            },
        );

        if (error) {
            console.error("Save temp messages error:", error);
            showNotification("Failed to save messages", "error");
            return;
        }

        const savedCount = data || 0;

        // Clear temp messages after saving
        await cleanupTempMessages(friendId);

        // CRITICAL FIX: Reload permanent messages to show the newly saved ones
        await loadPermanentMessages(friendId);

        // Refresh conversations to show saved messages
        loadLatestConversations();

        showNotification(`Saved ${savedCount} messages to permanent chat`, false);

        // Update save button state
        updateSaveIndicator(friendId);
    } catch (err) {
        console.error("Save temp messages error:", err);
        showNotification("Failed to save messages", "error");
    }
}

async function cleanupTempMessages(friendId) {
    try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
            console.error(
                "Supabase client not available for cleanup",
            );
            return;
        }

        await supabaseClient.rpc("cleanup_temp_messages", {
            _user_id: currentUser.id,
            _friend_id: friendId,
        });

        // Remove from local cache
        const chatKey = [currentUser.id, friendId].sort().join("-");
        tempMessages.delete(chatKey);

        // Update UI if this chat is currently open
        if (currentChat && currentChat.friendId === friendId) {
            renderCombinedMessages();
            updateSaveIndicator(friendId);
        }

        updateAllConversations();
    } catch (err) {
        console.error("Cleanup temp messages error:", err);
    }
}

function updateSaveIndicator(friendId) {
    const saveButton = document.getElementById("saveChatBtn");
    if (saveButton) {
        const hasMessages = getTempMessages(friendId).length > 0;
        saveButton.classList.remove("has-messages", "saved");

        if (hasMessages) {
            saveButton.classList.add("has-messages");
        } else {
            saveButton.classList.add("saved");
        }
    }
}

function updateAllConversations() {
    const tempConversations = [];
    const permanentConversations = [];

    // Process temp messages
    for (const [chatKey, messages] of tempMessages.entries()) {
        if (messages.length > 0) {
            const [userId1, userId2] = chatKey.split("-");
            const otherUserId =
                userId1 === currentUser.id ? userId2 : userId1;

            const friend = friends.find(
                (f) => f.friend_id === otherUserId,
            );
            if (friend) {
                const lastMessage = messages[messages.length - 1];
                tempConversations.push({
                    other_user_id: otherUserId,
                    other_user_name: friend.friend_name,
                    other_user_display_id: friend.friend_display_id,
                    last_content: lastMessage.content,
                    created_at: lastMessage.created_at,
                    is_temp: true,
                });
            }
        }
    }

    // Process permanent messages
    for (const [chatKey, messages] of permanentMessages.entries()) {
        if (messages.length > 0) {
            const [userId1, userId2] = chatKey.split("-");
            const otherUserId =
                userId1 === currentUser.id ? userId2 : userId1;

            const friend = friends.find(
                (f) => f.friend_id === otherUserId,
            );
            if (friend) {
                const lastMessage = messages[messages.length - 1];
                permanentConversations.push({
                    other_user_id: otherUserId,
                    other_user_name: friend.friend_name,
                    other_user_display_id: friend.friend_display_id,
                    last_content: lastMessage.content,
                    created_at: lastMessage.created_at,
                    is_temp: false,
                });
            }
        }
    }

    // Merge with existing conversations from server
    const allConversations = [...conversations];

    // Update or add temp conversations
    tempConversations.forEach((tempConv) => {
        const existingIndex = allConversations.findIndex(
            (conv) => conv.other_user_id === tempConv.other_user_id,
        );

        if (existingIndex >= 0) {
            // Update existing conversation with latest message if newer
            if (
                new Date(tempConv.created_at) >
                new Date(allConversations[existingIndex].created_at)
            ) {
                allConversations[existingIndex] = tempConv;
            }
        } else {
            // Add new conversation
            allConversations.push(tempConv);
        }
    });

    // Update or add permanent conversations
    permanentConversations.forEach((permConv) => {
        const existingIndex = allConversations.findIndex(
            (conv) => conv.other_user_id === permConv.other_user_id,
        );

        if (existingIndex >= 0) {
            // Update existing conversation with latest message if newer and not temp
            if (
                !allConversations[existingIndex].is_temp &&
                new Date(permConv.created_at) >
                    new Date(
                        allConversations[existingIndex].created_at,
                    )
            ) {
                allConversations[existingIndex] = permConv;
            }
        } else {
            // Add new conversation
            allConversations.push(permConv);
        }
    });

    const sortedConversations = allConversations.sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at),
    );
    conversations = sortedConversations;
    renderConversationsUI();
}
function renderConversationsUI() {
    const chatsList = document.getElementById("chatsList");

    // Clear existing content safely
    while (chatsList.firstChild) {
        chatsList.removeChild(chatsList.firstChild);
    }

    if (!conversations || conversations.length === 0) {
        const emptyState = document.createElement("div");
        emptyState.className = "empty-state";

        const emptyIcon = document.createElement("div");
        emptyIcon.className = "empty-icon";
        emptyIcon.textContent = "💬";

        const emptyTitle = document.createElement("h4");
        emptyTitle.textContent = "No conversations yet";

        const emptyText = document.createElement("p");
        emptyText.textContent = "Add friends to start chatting!";

        emptyState.appendChild(emptyIcon);
        emptyState.appendChild(emptyTitle);
        emptyState.appendChild(emptyText);
        chatsList.appendChild(emptyState);
        return;
    }

    conversations.forEach((conv) => {
        const chatItem = document.createElement("div");
        chatItem.className = `chat-item ${currentChat && currentChat.friendId === conv.other_user_id ? "active" : ""}`;
        chatItem.addEventListener("click", () =>
            openChat(conv.other_user_id, conv.other_user_name),
        );

        const chatAvatar = document.createElement("div");
        chatAvatar.className = "chat-avatar";
        chatAvatar.textContent = conv.other_user_name
            .charAt(0)
            .toUpperCase();

        const chatInfo = document.createElement("div");
        chatInfo.className = "chat-info";

        const chatName = document.createElement("div");
        chatName.className = "chat-name";
        chatName.textContent = conv.other_user_name;

        if (conv.is_temp) {
            const tempIndicator = document.createElement("span");
            tempIndicator.className = "temp-indicator";
            tempIndicator.textContent = "temp";
            chatName.appendChild(tempIndicator);
        }

        const chatPreview = document.createElement("div");
        chatPreview.className = "chat-preview";
        chatPreview.textContent =
            conv.last_content || "Start a conversation";

        chatInfo.appendChild(chatName);
        chatInfo.appendChild(chatPreview);

        chatItem.appendChild(chatAvatar);
        chatItem.appendChild(chatInfo);

        chatsList.appendChild(chatItem);
    });
}

async function openChat(friendId, friendName) {
    currentChat = { friendId, friendName };

    // Switch to chat view on mobile
    if (window.matchMedia("(max-width: 775px)").matches) {
        document.body.classList.add("chat-open");
    }

    const chatContent = document.getElementById("chatContent");

    // Clear existing content safely
    while (chatContent.firstChild) {
        chatContent.removeChild(chatContent.firstChild);
    }

    // Create all the chat UI elements (same as before)
    const chatHeader = document.createElement("div");
    chatHeader.className = "chat-header";

    const backToChats = document.createElement("div");
    backToChats.className = "back-to-chats";
    backToChats.id = "backToChats";
    backToChats.textContent = "Back to chats";

    const chatHeaderContent = document.createElement("div");
    chatHeaderContent.className = "chat-header-content";

    const chatHeaderAvatar = document.createElement("div");
    chatHeaderAvatar.className = "chat-header-avatar";
    chatHeaderAvatar.textContent = friendName
        .charAt(0)
        .toUpperCase();

    const chatHeaderInfo = document.createElement("div");
    chatHeaderInfo.className = "chat-header-info";

    const chatTitle = document.createElement("h3");
    chatTitle.textContent = friendName;

    const realtimeStatus = document.createElement("div");
    realtimeStatus.className = `realtime-status ${isRealtimeConnected ? "" : "disconnected"}`;
    const statusDot = document.createElement("span");
    statusDot.className = "status-dot";
    realtimeStatus.appendChild(statusDot);
    realtimeStatus.appendChild(
        document.createTextNode(
            isRealtimeConnected ? "Live" : "Offline",
        ),
    );
    chatTitle.appendChild(realtimeStatus);

    const chatSubtitle = document.createElement("p");
    chatSubtitle.textContent =
        "Messages auto-delete based on activity";

    chatHeaderInfo.appendChild(chatTitle);
    chatHeaderInfo.appendChild(chatSubtitle);

    const saveChatBtn = document.createElement("button");
    saveChatBtn.className = "save-chat-btn";
    saveChatBtn.id = "saveChatBtn";
    saveChatBtn.title = "Save temporary messages to permanent chat";
    saveChatBtn.addEventListener("click", () =>
        saveTempMessagesToPermanent(friendId),
    );

    const saveIcon = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
    );
    saveIcon.setAttribute("width", "16");
    saveIcon.setAttribute("height", "16");
    saveIcon.setAttribute("viewBox", "0 0 24 24");
    saveIcon.setAttribute("fill", "none");
    saveIcon.setAttribute("stroke", "currentColor");
    saveIcon.setAttribute("stroke-width", "2");

    const path1 = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
    );
    path1.setAttribute(
        "d",
        "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z",
    );
    const polyline1 = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "polyline",
    );
    polyline1.setAttribute("points", "17,21 17,13 7,13 7,21");
    const polyline2 = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "polyline",
    );
    polyline2.setAttribute("points", "7,3 7,8 15,8");

    saveIcon.appendChild(path1);
    saveIcon.appendChild(polyline1);
    saveIcon.appendChild(polyline2);

    const saveText = document.createElement("span");
    saveText.className = "save-text";
    saveText.textContent = "Save";

    saveChatBtn.appendChild(saveIcon);
    saveChatBtn.appendChild(saveText);

    chatHeaderContent.appendChild(chatHeaderAvatar);
    chatHeaderContent.appendChild(chatHeaderInfo);
    chatHeaderContent.appendChild(saveChatBtn);

    chatHeader.appendChild(backToChats);
    chatHeader.appendChild(chatHeaderContent);

    // Create messages container
    const messagesContainer = document.createElement("div");
    messagesContainer.className = "messages-container";
    messagesContainer.id = "messagesContainer";

    // Create message input container
    const messageInputContainer = document.createElement("div");
    messageInputContainer.className = "message-input-container";

    const messageForm = document.createElement("form");
    messageForm.className = "message-input-form";
    messageForm.id = "messageForm";

    const messageInput = document.createElement("input");
    messageInput.type = "text";
    messageInput.className = "message-input";
    messageInput.id = "messageInput";
    messageInput.placeholder = "Type a message...";
    messageInput.required = true;

    const sendBtn = document.createElement("button");
    sendBtn.type = "submit";
    sendBtn.className = "send-btn";
    sendBtn.textContent = "➤";

    messageForm.appendChild(messageInput);
    messageForm.appendChild(sendBtn);
    messageInputContainer.appendChild(messageForm);

    // Append all elements to chat content
    chatContent.appendChild(chatHeader);
    chatContent.appendChild(messagesContainer);
    chatContent.appendChild(messageInputContainer);

    // CRITICAL FIX: Load both temp AND permanent messages
    await Promise.all([
        loadTempMessages(friendId),
        loadPermanentMessages(friendId), // This ensures saved messages are loaded
    ]);

    renderConversationsUI(); // Update active state in conversations

    // Focus on message input
    setTimeout(() => {
        const messageInput =
            document.getElementById("messageInput");
        if (messageInput) messageInput.focus();
    }, 100);
}

function openChatFromFriend(friendId, friendName) {
    switchTab("chats");
    openChat(friendId, friendName);
}

function renderCombinedMessages() {
    const messagesContainer =
        document.getElementById("messagesContainer");
    if (!messagesContainer || !currentChat) return;

    const messages = getCombinedMessages(currentChat.friendId);

    // Clear existing content safely
    while (messagesContainer.firstChild) {
        messagesContainer.removeChild(messagesContainer.firstChild);
    }

    if (messages.length === 0) {
        const emptyState = document.createElement("div");
        emptyState.className = "empty-state";

        const emptyIcon = document.createElement("div");
        emptyIcon.className = "empty-icon";
        emptyIcon.textContent = "💬";

        const emptyTitle = document.createElement("h4");
        emptyTitle.textContent = "No messages yet";

        const emptyText = document.createElement("p");
        emptyText.textContent =
            "Start the conversation by sending a message!";

        emptyState.appendChild(emptyIcon);
        emptyState.appendChild(emptyTitle);
        emptyState.appendChild(emptyText);
        messagesContainer.appendChild(emptyState);
        return;
    }

    messages.forEach((msg) => {
        const isOwn = msg.sender_id === currentUser.id;
        const time = new Date(msg.created_at).toLocaleTimeString(
            [],
            { hour: "2-digit", minute: "2-digit" },
        );

        const messageDiv = document.createElement("div");
        messageDiv.className = `message ${isOwn ? "own" : ""} ${msg.is_pending ? "pending" : ""}`;

        const messageBubble = document.createElement("div");
        messageBubble.className = "message-bubble";

        const messageContent = document.createElement("div");
        messageContent.className = "message-content";
        messageContent.textContent = msg.content;

        const messageTime = document.createElement("div");
        messageTime.className = "message-time";
        messageTime.textContent = time + " ";

        const indicator = document.createElement("span");
        if (msg.is_pending) {
            indicator.className = "temp-indicator";
            indicator.textContent = "sending...";
        } else if (msg.expires_at) {
            // This is a temp message
            indicator.className = "temp-indicator";
            indicator.textContent = "temp";
        } else {
            // This is a saved/permanent message - FIXED CONDITION
            indicator.className = "permanent-indicator";
            indicator.textContent = "saved";
        }

        messageTime.appendChild(indicator);
        messageBubble.appendChild(messageContent);
        messageBubble.appendChild(messageTime);
        messageDiv.appendChild(messageBubble);
        messagesContainer.appendChild(messageDiv);
    });

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function renderFriendsUI() {
    const friendsList = document.getElementById("friendsList");

    // Clear existing content safely
    while (friendsList.firstChild) {
        friendsList.removeChild(friendsList.firstChild);
    }

    if (!friends || friends.length === 0) {
        const emptyState = document.createElement("div");
        emptyState.className = "empty-state";

        const emptyIcon = document.createElement("div");
        emptyIcon.className = "empty-icon";
        emptyIcon.textContent = "👥";

        const emptyTitle = document.createElement("h4");
        emptyTitle.textContent = "No friends yet";

        const emptyText = document.createElement("p");
        emptyText.textContent = "Add friends using the form above!";

        emptyState.appendChild(emptyIcon);
        emptyState.appendChild(emptyTitle);
        emptyState.appendChild(emptyText);
        friendsList.appendChild(emptyState);
        return;
    }

    friends.forEach((friend) => {
        const friendItem = document.createElement("div");
        friendItem.className = "friend-item";

        const chatAvatar = document.createElement("div");
        chatAvatar.className = "chat-avatar";
        chatAvatar.textContent = friend.friend_name
            .charAt(0)
            .toUpperCase();

        const friendInfo = document.createElement("div");
        friendInfo.className = "friend-info";

        const friendName = document.createElement("div");
        friendName.className = "friend-name";
        friendName.textContent = friend.friend_name;

        const friendStatus = document.createElement("div");
        friendStatus.className = "friend-status";
        friendStatus.textContent = `Online • ${friend.friend_display_id}`;

        friendInfo.appendChild(friendName);
        friendInfo.appendChild(friendStatus);

        const friendActions = document.createElement("div");
        friendActions.className = "friend-actions";

        const chatBtn = document.createElement("button");
        chatBtn.className = "btn-small btn-chat";
        chatBtn.textContent = "Chat";
        chatBtn.addEventListener("click", () =>
            openChatFromFriend(
                friend.friend_id,
                friend.friend_name,
            ),
        );

        const removeBtn = document.createElement("button");
        removeBtn.className = "btn-small btn-remove";
        removeBtn.textContent = "Remove";
        removeBtn.addEventListener("click", () =>
            removeFriend(friend.friend_id),
        );

        friendActions.appendChild(chatBtn);
        friendActions.appendChild(removeBtn);

        friendItem.appendChild(chatAvatar);
        friendItem.appendChild(friendInfo);
        friendItem.appendChild(friendActions);

        friendsList.appendChild(friendItem);
    });
}

// Tab switching
function switchTab(tabName) {
    activeTab = tabName;

    document
        .querySelectorAll(".tab")
        .forEach((tab) => tab.classList.remove("active"));
    document
        .getElementById(tabName + "Tab")
        .classList.add("active");

    document
        .getElementById("chatsContent")
        .classList.toggle("hidden", tabName !== "chats");
    document
        .getElementById("friendsContent")
        .classList.toggle("hidden", tabName !== "friends");
}

// Window/tab close cleanup
window.addEventListener("beforeunload", () => {
    if (currentChat) {
        // Fire and forget cleanup - messages will auto-delete based on rules
        navigator.sendBeacon &&
            navigator.sendBeacon(
                "/api/cleanup",
                JSON.stringify({
                    userId: currentUser.id,
                    friendId: currentChat.friendId,
                }),
            );
    }
});

// Event listeners
document.addEventListener("DOMContentLoaded", function () {
    // Auth event listeners
    document
        .getElementById("loginForm")
        .addEventListener("submit", handleLogin);
    document
        .getElementById("registerForm")
        .addEventListener("submit", handleRegister);
    document
        .getElementById("showRegister")
        .addEventListener("click", function () {
            document
                .getElementById("loginForm")
                .classList.add("hidden");
            document
                .getElementById("registerForm")
                .classList.remove("hidden");
        });
    document
        .getElementById("showLogin")
        .addEventListener("click", showLogin);

    // App event listeners
    document
        .getElementById("logoutBtn")
        .addEventListener("click", logout);
    document
        .getElementById("addFriendForm")
        .addEventListener("submit", addFriend);

    // Tab switching
    document
        .getElementById("chatsTab")
        .addEventListener("click", () => switchTab("chats"));
    document
        .getElementById("friendsTab")
        .addEventListener("click", () => switchTab("friends"));

    // User ID copy functionality
    document
        .getElementById("userId")
        .addEventListener("click", function () {
            if (!currentUser) return;
            const displayId = currentUser.displayId;
            if (navigator.clipboard) {
                navigator.clipboard
                    .writeText(displayId)
                    .then(() => {
                        showNotification(
                            "Your user ID copied to clipboard!",
                        );
                    })
                    .catch(() => {
                        fallbackCopyTextToClipboard(displayId);
                    });
            } else {
                fallbackCopyTextToClipboard(displayId);
            }
        });

    // Back to chats button (delegated event listener)
    document.addEventListener("click", function (e) {
        if (
            e.target.id === "backToChats" ||
            e.target.closest("#backToChats")
        ) {
            document.body.classList.remove("chat-open");
        }
    });

    // Message form (delegated event listener)
    document.addEventListener("submit", function (e) {
        if (e.target.id === "messageForm") {
            sendTempMessage(e);
        }
    });

    // Enter key in message input
    document.addEventListener("keydown", function (e) {
        if (
            e.target.id === "messageInput" &&
            e.key === "Enter" &&
            !e.shiftKey
        ) {
            e.preventDefault();
            const form = document.getElementById("messageForm");
            if (form) form.dispatchEvent(new Event("submit"));
        }
    });
});

// Fallback copy function for older browsers
function fallbackCopyTextToClipboard(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        document.execCommand("copy");
        showNotification("Your user ID copied to clipboard!", false);
    } catch (err) {
        showNotification("Failed to copy to clipboard", "error");
    }
    document.body.removeChild(textArea);
}

// Global functions for onclick handlers
window.openChat = openChat;
window.openChatFromFriend = openChatFromFriend;
window.removeFriend = removeFriend;
window.saveTempMessagesToPermanent = saveTempMessagesToPermanent;
---

let connectionCheckInterval;

function showNotification(message, isError = true, duration = 6000) {
  const box = document.getElementById("notify");
  box.textContent = message;
  box.style.display = "block";
  
  if (isError) {
    box.style.background = "#ffdddd";
    box.style.color = "#a30000";
    box.style.borderColor = "#a30000";
  } else {
    box.style.background = "#ddffdd";
    box.style.color = "#006600";
    box.style.borderColor = "#006600";
  }

  setTimeout(() => {
    box.style.display = "none";
  }, duration);
}

function showConnectionStatus(message, type = 'warning') {
  const status = document.getElementById("connectionStatus");
  status.textContent = message;
  status.style.display = "block";
  
  switch(type) {
    case 'error':
      status.style.background = "#ffdddd";
      status.style.color = "#a30000";
      break;
    case 'success':
      status.style.background = "#ddffdd";
      status.style.color = "#006600";
      break;
    default:
      status.style.background = "#ffeb3b";
      status.style.color = "#333";
  }

  if (type === 'success') {
    setTimeout(() => {
      status.style.display = "none";
    }, 3000);
  }
}

function hideConnectionStatus() {
  document.getElementById("connectionStatus").style.display = "none";
}

async function checkSupabaseConnection() {
  try {
    // Check if Supabase client exists
    if (!window.supabase) {
      throw new Error("SUPABASE_NOT_INITIALIZED");
    }

    // Test connection with a simple query
    const { data, error } = await window.supabase
      .from('users')
      .select('count')
      .limit(1);

    if (error) {
      throw new Error(`SUPABASE_ERROR: ${error.message}`);
    }

    showConnectionStatus("Connected", 'success');
    return true;
  } catch (err) {
    let errorMessage = "Connection Error: ";
    let suggestions = "";

    if (err.message.includes("SUPABASE_NOT_INITIALIZED")) {
      errorMessage += "Supabase client not found";
      suggestions = "\n\nPossible fixes:\n• Check if main.js is loading\n• Verify VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY\n• Check browser console for errors";
    } else if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError")) {
      errorMessage += "Network connection failed";
      suggestions = "\n\nPossible fixes:\n• Check your internet connection\n• Verify Supabase project is active\n• Check if domain is whitelisted in Supabase\n• Ensure HTTPS is being used";
    } else if (err.message.includes("CORS")) {
      errorMessage += "CORS policy error";
      suggestions = "\n\nFix: Add your domain to Supabase CORS settings";
    } else if (err.message.includes("relation") && err.message.includes("does not exist")) {
      errorMessage += "Database table missing";
      suggestions = "\n\nFix: Create required database tables in Supabase";
    } else {
      errorMessage += err.message;
      suggestions = "\n\nCheck browser console for more details";
    }

    showConnectionStatus("Connection Failed", 'error');
    showNotification(errorMessage + suggestions, true, 10000);
    return false;
  }
}

// Enhanced login function with better error handling
async function handleEnhancedLogin(username, password) {
  const loginBtn = document.querySelector('#loginForm button[type="submit"]');
  const inputs = document.querySelectorAll('#loginForm input');
  
  try {
    // Disable form during login attempt
    loginBtn.textContent = "Signing In...";
    loginBtn.disabled = true;
    inputs.forEach(input => input.disabled = true);

    // Check connection first
    const isConnected = await checkSupabaseConnection();
    if (!isConnected) {
      throw new Error("CONNECTION_FAILED");
    }

    // Validate inputs
    if (!username || username.length < 3) {
      throw new Error("Username must be at least 3 characters long");
    }
    if (!password || password.length < 6) {
      throw new Error("Password must be at least 6 characters long");
    }

    // Attempt login
    const { data, error } = await window.supabase.rpc('login_user', {
      _username: username.trim(),
      _password: password
    });

    if (error) {
      if (error.message.includes("function login_user") && error.message.includes("does not exist")) {
        throw new Error("LOGIN_FUNCTION_MISSING: Database function 'login_user' not found.\n\nPlease ensure all database functions are created in Supabase.");
      }
      throw new Error(`LOGIN_RPC_ERROR: ${error.message}`);
    }

    if (!data || data.length === 0) {
      throw new Error("Invalid username or password.\n\nPlease check your credentials and try again.");
    }

    // Success
    hideConnectionStatus();
    showNotification(`Welcome back, ${data[0].username}!`, false);
    
    // Continue with your existing login success logic here
    // currentUser = { ... }; 
    // showApp();
    
  } catch (err) {
    let userMessage = "";
    
    if (err.message === "CONNECTION_FAILED") {
      userMessage = "Cannot connect to server. Please check your connection and try again.";
    } else if (err.message.includes("LOGIN_FUNCTION_MISSING")) {
      userMessage = err.message;
    } else if (err.message.includes("Failed to fetch")) {
      userMessage = "Network error occurred.\n\nPossible fixes:\n• Check internet connection\n• Refresh the page\n• Try again in a few moments";
    } else if (err.message.includes("LOGIN_RPC_ERROR")) {
      userMessage = `Login failed: ${err.message.replace("LOGIN_RPC_ERROR: ", "")}`;
    } else {
      userMessage = err.message;
    }
    
    showNotification(userMessage, true);
    console.error("Login error details:", err);
    
  } finally {
    // Re-enable form
    loginBtn.textContent = "Sign In";
    loginBtn.disabled = false;
    inputs.forEach(input => input.disabled = false);
  }
}

// Initialize when page loads
document.addEventListener("DOMContentLoaded", () => {
  // Show connection checking status
  showConnectionStatus("Checking connection...");
  
  // Check connection after a short delay to allow scripts to load
  setTimeout(() => {
    checkSupabaseConnection();
  }, 1000);

  // Replace the existing login form handler
  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("loginUsername").value;
      const password = document.getElementById("loginPassword").value;
      await handleEnhancedLogin(username, password);
    });
  }

  // Periodic connection check (every 30 seconds)
  connectionCheckInterval = setInterval(() => {
    if (document.getElementById("connectionStatus").style.display !== "none") {
      checkSupabaseConnection();
    }
  }, 30000);
});

// Clean up interval when page unloads
window.addEventListener("beforeunload", () => {
  if (connectionCheckInterval) {
    clearInterval(connectionCheckInterval);
  }
});

// Make functions globally available
window.showNotification = showNotification;
window.checkSupabaseConnection = checkSupabaseConnection;
