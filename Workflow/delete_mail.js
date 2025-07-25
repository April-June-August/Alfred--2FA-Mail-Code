#!/usr/bin/osascript -l JavaScript

// Helper function to find and delete message by ID
function findAndDeleteMessage(messages, messageIdToDelete) {
    for (const message of messages) {
        try {
            const messageId = message.id();
            if (messageId === messageIdToDelete) {
                // Found the message, try to delete it
                message.delete();
                return true;
            }
        } catch (error) {
            // Skip messages that can't be processed
            continue;
        }
    }
    return false;
}

// Main function to delete mail by ID
function deleteMailById(messageIdToDelete) {
    // Access the Mail application
    const Mail = Application('Mail');
    Mail.includeStandardAdditions = true;

    try {
        // Get the mailboxes
        const junkMailbox = Mail.junkMailbox;
        const inboxMailbox = Mail.inbox;
        
        // Retrieve messages from each mailbox (if available)
        const junkMessages = junkMailbox ? junkMailbox.messages() : [];
        const inboxMessages = inboxMailbox ? inboxMailbox.messages() : [];

        // Search in inbox first
        if (findAndDeleteMessage(inboxMessages, messageIdToDelete)) {
            return true;
        }

        // If not found in inbox, search in junk
        if (findAndDeleteMessage(junkMessages, messageIdToDelete)) {
            return true;
        }

        // Message not found in either mailbox
        console.log(`Message with ID ${messageIdToDelete} not found in either mailbox`);
        return false;

    } catch (error) {
        // Handle any Mail app access errors or other issues
        console.log(`Error accessing Mail app or deleting message: ${error.message}`);
        return false;
    }
}

function run(argv) {
    // Check if message ID argument is provided
    if (!argv || argv.length === 0) {
        return false;
    }
    
    const messageIdToDelete = parseInt(argv[0]);
    return deleteMailById(messageIdToDelete);
}