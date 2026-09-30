"""Provider-independent voice instructions for MOCK and SIP/PBX integrations.

This module does not pretend to terminate PSTN calls. A PBX/carrier must deliver
real call events to the signed webhook endpoints and confirm bridge state.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class VoiceInstruction:
    action: str
    prompt: str | None = None
    gather_digits: int | None = None
    bridge_target: str | None = None
    metadata: dict | None = None

    def as_dict(self) -> dict:
        return {
            key: value
            for key, value in {
                "action": self.action,
                "prompt": self.prompt,
                "gather_digits": self.gather_digits,
                "bridge_target": self.bridge_target,
                "metadata": self.metadata,
            }.items()
            if value is not None
        }


class TelephonyAdapter(ABC):
    mode: str

    @abstractmethod
    def gather(self, prompt: str, digits: int = 1) -> VoiceInstruction:
        raise NotImplementedError

    @abstractmethod
    def bridge(self, target_e164: str, call_id: str) -> VoiceInstruction:
        raise NotImplementedError

    def hangup(self, prompt: str | None = None) -> VoiceInstruction:
        return VoiceInstruction(action="HANGUP", prompt=prompt)


class MockTelephonyAdapter(TelephonyAdapter):
    mode = "MOCK"

    def gather(self, prompt: str, digits: int = 1) -> VoiceInstruction:
        return VoiceInstruction(action="MOCK_GATHER", prompt=prompt, gather_digits=digits)

    def bridge(self, target_e164: str, call_id: str) -> VoiceInstruction:
        # This is an instruction for tests only, never a claim that audio connected.
        return VoiceInstruction(
            action="MOCK_BRIDGE_PENDING",
            bridge_target=target_e164,
            metadata={"call_id": call_id, "connected": False},
        )


class SipPbxTelephonyAdapter(TelephonyAdapter):
    mode = "SIP_PBX"

    def gather(self, prompt: str, digits: int = 1) -> VoiceInstruction:
        return VoiceInstruction(action="PBX_GATHER_DTMF", prompt=prompt, gather_digits=digits)

    def bridge(self, target_e164: str, call_id: str) -> VoiceInstruction:
        # The signed bridge_connected event is the only event that marks a call live.
        return VoiceInstruction(
            action="PBX_BRIDGE_REQUEST",
            bridge_target=target_e164,
            metadata={"call_id": call_id, "connected": False},
        )


def get_telephony_adapter(provider_mode: str) -> TelephonyAdapter:
    return SipPbxTelephonyAdapter() if provider_mode == "SIP_PBX" else MockTelephonyAdapter()
