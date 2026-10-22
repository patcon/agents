# Dembrane prototypes

Voice conversations where people talk while questions reach them, and their answers are recorded alongside what they said.

## Language

**Session**:
One conversation, with one log that every device in it shares.
_Avoid_: Room, group, conversation agent

**Log**:
The append-only record of everything that happened in a session.
_Avoid_: History, transcript (the transcript is only the utterances in it)

**Device**:
A client connected to a session. It holds one or more participants, and different devices may show different interfaces onto the same log.
_Avoid_: Connection, client, seat

**Participant**:
A person taking part in a session. A participant is on exactly one device at a time, and can detach from that device to another one.
_Avoid_: User, speaker, member
