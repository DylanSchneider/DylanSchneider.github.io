/* Short, actionable messages for party guests and hosts. */
const messages = [
  [/wrong pin/i, 'That key doesn’t fit. Check your host PIN.'],
  [/no admin pin/i, 'The host PIN hasn’t been set yet.'],
  [/first and last name/i, 'Enter a first and last name.'],
  [/10-digit|all 10 digits/i, 'Enter a 10-digit mobile number.'],
  [/costumes are locked/i, 'Voting is closed. Costumes can no longer be changed.'],
  [/voting has not opened/i, 'Voting hasn’t begun just yet.'],
  [/voting is closed/i, 'Time’s up. Voting is closed.'],
  [/results are hidden/i, 'The crown will be revealed when voting closes.'],
  [/party photo wall is closed/i, 'The camera has retired for the night.'],
  [/cannot vote for your own/i, 'Choose someone else’s costume.'],
  [/already have a costume/i, 'Your costume is already entered. Choose Edit your costume.'],
  [/check in with your name/i, 'Your invitation awaits. Check in first.'],
  [/have not entered a costume/i, 'Enter your costume first.'],
  [/group no longer exists/i, 'That group has wandered off. Choose another.'],
  [/costume is no longer listed/i, 'That costume has wandered off. Choose another.'],
  [/costume is solo/i, 'That costume is solo. Choose a group to join.'],
  [/only the person who started/i, 'Only your group’s starter can change its name or photo.'],
  [/you started this group and/i, 'Your group has other members. Ask the host to remove it.'],
  [/give your costume|give your group/i, 'Give your costume or group a name.'],
  [/what are you dressed as|enter.*costume or role/i, 'Enter your costume or character.'],
  [/choose either a solo or group/i, 'Choose Solo or Group.'],
  [/photo.*required|versions are required/i, 'Add a photo to continue.'],
  [/image looks empty|read as an image|process that photo/i, 'Try a different photo.'],
  [/payload too large|too big|too large/i, 'Choose a smaller photo.'],
  [/ran out of demo storage/i, 'This dress rehearsal is full. Try another device.'],
  [/guest could not be found/i, 'That guest is no longer on the list. Refresh and try again.'],
  [/testing reset is disabled/i, 'The rehearsal reset is locked.'],
  [/that was already saved/i, 'Already saved.'],
  [/offline|wifi|failed to fetch|network|could not reach/i, 'Connection lost. Check your connection and try again.']
];

export function messageFor(error, fallback = 'A curious mishap. Please try again.') {
  const text = String(error?.message || error || '');
  return messages.find(([pattern]) => pattern.test(text))?.[1] || fallback;
}
