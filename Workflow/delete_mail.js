#!/usr/bin/osascript -l JavaScript

// Helper function to find and delete message by ID in a list of messages
function findAndDeleteMessage(messages, messageIdToDelete, maxToCheck = 100) {
    const limit = Math.min(messages.length, maxToCheck);
    for (let i = 0; i < limit; i++) {
        try {
            const message = messages[i];
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

// Try to find message in a specific account's inbox
function findInAccountInbox(Mail, accountName, messageIdToDelete) {
    if (!accountName) return false;

    try {
        const accounts = Mail.accounts();
        for (let i = 0; i < accounts.length; i++) {
            const account = accounts[i];
            if (account.name() === accountName) {
                const mailboxes = account.mailboxes();
                for (let j = 0; j < mailboxes.length; j++) {
                    const mailbox = mailboxes[j];
                    const mailboxName = mailbox.name();
                    if (mailboxName === 'INBOX' || mailboxName.toLowerCase() === 'inbox') {
                        const messages = mailbox.messages();
                        if (findAndDeleteMessage(messages, messageIdToDelete, 50)) {
                            console.log(`Deleted from ${accountName}/INBOX`);
                            return true;
                        }
                        break;
                    }
                }
                break;
            }
        }
    } catch (error) {
        console.log(`Error searching account ${accountName}: ${error.message}`);
    }
    return false;
}

// Search all account inboxes for the message
function findInAllAccounts(Mail, messageIdToDelete) {
    try {
        const accounts = Mail.accounts();
        for (let i = 0; i < accounts.length; i++) {
            try {
                const account = accounts[i];
                const accountName = account.name();
                const mailboxes = account.mailboxes();

                for (let j = 0; j < mailboxes.length; j++) {
                    const mailbox = mailboxes[j];
                    const mailboxName = mailbox.name();
                    if (mailboxName === 'INBOX' || mailboxName.toLowerCase() === 'inbox') {
                        const messages = mailbox.messages();
                        if (findAndDeleteMessage(messages, messageIdToDelete, 50)) {
                            console.log(`Deleted from ${accountName}/INBOX`);
                            return true;
                        }
                        break;
                    }
                }
            } catch (error) {
                continue;
            }
        }
    } catch (error) {
        console.log(`Error searching accounts: ${error.message}`);
    }
    return false;
}

// Main function to delete mail by ID
function deleteMailById(messageIdToDelete, accountName) {
    // Access the Mail application
    const Mail = Application('Mail');
    Mail.includeStandardAdditions = true;

    try {
        // First, try the specific account if provided (fastest)
        if (accountName && findInAccountInbox(Mail, accountName, messageIdToDelete)) {
            return true;
        }

        // Fallback: search all account inboxes
        if (findInAllAccounts(Mail, messageIdToDelete)) {
            return true;
        }

        // Last resort: check junk mail
        try {
            const junkMailbox = Mail.junkMailbox;
            if (junkMailbox) {
                const junkMessages = junkMailbox.messages();
                if (findAndDeleteMessage(junkMessages, messageIdToDelete, 50)) {
                    console.log('Deleted from Junk');
                    return true;
                }
            }
        } catch (error) {
            console.log(`Error checking junk: ${error.message}`);
        }

        // Message not found
        console.log(`Message with ID ${messageIdToDelete} not found`);
        return false;

    } catch (error) {
        console.log(`Error: ${error.message}`);
        return false;
    }
}

function run(argv) {
    // Check if message ID argument is provided
    if (!argv || argv.length === 0) {
        return false;
    }

    const messageIdToDelete = parseInt(argv[0]);

    // Get account name from Alfred environment variable (set by mail_code.js)
    const env = $.NSProcessInfo.processInfo.environment;
    const accountNameObj = env.objectForKey($('accountName'));
    const accountName = accountNameObj ? accountNameObj.js : '';

    return deleteMailById(messageIdToDelete, accountName);
}