function Message(recipient, sender, subject, content) {

  /* Function Message
   * Creates default object for message with variable content
   */

  return {
    "recipient": recipient,
    "sender": sender,
    "subject": escapeHTML(subject),
    "content": escapeHTML(content),
    "read": false,
    "recipientDeleted": false,
    "senderDeleted": false,
    "created": new Date(),
    "level": 0
  }

}

function escapeHTML(string) {

  /* function escapeHTML
   * Escapes HTML in user provided content
   */

  const entityMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
    "/": "&#x2F;",
    "`": "&#x60;",
    "=": "&#x3D;"
  }

  // Replace entities
  return String(string).replace(/[&<>"'`=\/]/g, function(character) {
    return entityMap[character];
  });

}

module.exports.Message = Message;
module.exports.escapeHTML = escapeHTML;
