# TF15 exit restoration

TF15 only: TP1 locks SL at the frozen setup entry (BE); TP2 locks TP1; TP3 locks TP2. No additional TP3 lock at +3.00 in this restored policy. Native chart Close Separuh or Close All closes all owned positions of the active TF15 setup. Locks only tighten. Existing setups retain their stored exit version.

New TF15 Pine metadata requires PINE_STEPLOCK_BE_TF15_V1 to prevent an old alert from authorizing a new BE setup while emitting incompatible lock levels. Replace TF15 Pine and recreate Unified alert. Install Connector 2.1.5 / EA 2.12 for the local terminal fallback. New code still accepts old exit versions for existing positions.

TF15 entry SOP, ATR14, SL/TP and MTF15/30/45 remain unchanged. TF2 Pine and strategy files are unchanged: ATR10, SL distance min(ATR10,3.00), existing +1.50 StepLock and TP3 extension. Shared execution changes recognize the new BE version only for TF15.
