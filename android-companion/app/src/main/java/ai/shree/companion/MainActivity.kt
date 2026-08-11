package ai.shree.companion

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CloudQueue
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.FormatListBulleted
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import ai.shree.companion.control.ConfirmationBroker
import ai.shree.companion.protocol.ChatEntry
import ai.shree.companion.protocol.MemoryItem
import ai.shree.companion.protocol.ReminderItem
import ai.shree.companion.protocol.SystemStatus
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.delay
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import kotlin.math.abs
import kotlin.math.sin

private val Night = Color(0xFF02050B)
private val Panel = Color(0xE60A0D18)
private val Cyan = Color(0xFF00D9FF)
private val Magenta = Color(0xFFFF2ED1)
private val Violet = Color(0xFF875CFF)
private val Success = Color(0xFF20E3A2)
private val Warning = Color(0xFFFFB84D)
private val Danger = Color(0xFFFF5470)
private val Muted = Color(0xFF7E8BA7)

private enum class MobileSection { Home, Chat, Voice, Memory, Settings }

class MainActivity : ComponentActivity() {
    private var scanSuccess: ((String) -> Unit)? = null
    private var scanFailure: ((String) -> Unit)? = null
    private val qrScanner = registerForActivityResult(ScanContract()) { result ->
        val contents = result.contents
        if (contents.isNullOrBlank()) scanFailure?.invoke("QR scanning was cancelled. Please try again.")
        else scanSuccess?.invoke(contents)
        scanSuccess = null
        scanFailure = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { ShreeTheme { CompanionScreen(onScan = ::scanQr) } }
    }

    private fun scanQr(onValue: (String) -> Unit, onError: (String) -> Unit) {
        scanSuccess = onValue
        scanFailure = onError
        val options = ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt("Place the SHREE pairing code inside the frame").setBeepEnabled(false)
            .setBarcodeImageEnabled(false).setOrientationLocked(false)
        runCatching { qrScanner.launch(options) }.onFailure { error ->
            scanSuccess = null; scanFailure = null
            onError(error.message ?: "The camera scanner could not start")
        }
    }
}

@Composable
private fun ShreeTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Cyan, secondary = Magenta, background = Night, surface = Panel,
            onPrimary = Night, onBackground = Color(0xFFF5F7FF), onSurface = Color(0xFFF5F7FF),
        ), content = content,
    )
}

@Composable
private fun CompanionScreen(
    onScan: ((String) -> Unit, (String) -> Unit) -> Unit,
    model: MainViewModel = viewModel(),
) {
    val paired by model.paired.collectAsState()
    val setup by model.setupStatus.collectAsState()
    val link by model.linkStatus.collectAsState()
    val voice by model.voiceStatus.collectAsState()
    val transcript by model.transcript.collectAsState()
    val memories by model.memories.collectAsState()
    val reminders by model.reminders.collectAsState()
    val chat by model.chat.collectAsState()
    val systemStatus by model.systemStatus.collectAsState()
    val confirmation by ConfirmationBroker.pending.collectAsState()
    val context = LocalContext.current
    var section by remember { mutableStateOf(MobileSection.Home) }
    var showReminderDialog by remember { mutableStateOf(false) }
    val pageScroll = rememberScrollState()
    LaunchedEffect(section) { pageScroll.scrollTo(0) }
    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) model.toggleVoice() else model.reportSetupError("Microphone permission is required for voice conversation.")
    }
    val phonePermissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }
    val stateColor = when {
        voice.startsWith("error") -> Danger
        voice == "speaking" -> Magenta
        voice == "listening" -> Cyan
        link == "connected" -> Success
        else -> Warning
    }
    val toggleVoice = {
        if (voice != "idle" && !voice.startsWith("error")) model.toggleVoice()
        else if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) model.toggleVoice()
        else micPermission.launch(Manifest.permission.RECORD_AUDIO)
    }

    Box(Modifier.fillMaxSize().background(Night)) {
        FuturisticBackground(stateColor)
        Column(
            Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)
                .verticalScroll(pageScroll).padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            ShreeHeader(link = link, paired = paired, onSettings = { section = MobileSection.Settings })
            Spacer(Modifier.height(16.dp))
            if (!paired) {
                PairingConsole(setup = setup, onScan = { onScan(model::pair, model::reportSetupError) })
            } else {
                when (section) {
                    MobileSection.Home -> HomeDashboard(
                        voice, stateColor, transcript, chat, reminders, memories, systemStatus,
                        onToggleVoice = toggleVoice,
                        onChat = { section = MobileSection.Chat },
                        onAddReminder = { showReminderDialog = true },
                        onToggleReminder = model::toggleReminder,
                        onDeleteReminder = model::deleteReminder,
                        onMemory = { section = MobileSection.Memory },
                    )
                    MobileSection.Chat -> ChatScreen(chat, transcript, model::sendText)
                    MobileSection.Voice -> VoiceScreen(voice, stateColor, transcript, toggleVoice)
                    MobileSection.Memory -> MemoryScreen(memories)
                    MobileSection.Settings -> SystemTools(
                        onPermissions = {
                            val requested = mutableListOf(
                                Manifest.permission.CAMERA, Manifest.permission.CALL_PHONE,
                                Manifest.permission.READ_CONTACTS, Manifest.permission.READ_CALENDAR,
                                Manifest.permission.ACCESS_FINE_LOCATION,
                            )
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) requested += Manifest.permission.POST_NOTIFICATIONS
                            phonePermissions.launch(requested.toTypedArray())
                        },
                        onPhoneControl = { context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) },
                        onNotifications = { context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) },
                        onRefresh = model::refreshDashboard,
                        onUnpair = model::unpair,
                    )
                }
                Spacer(Modifier.height(14.dp))
                BottomNavigation(section) { section = it }
            }
            Spacer(Modifier.height(12.dp))
            Text("SHREE MARK 12  ·  SECURE COMPANION", fontSize = 8.sp, letterSpacing = 1.6.sp, color = Muted.copy(alpha = .65f))
        }
    }

    if (showReminderDialog) {
        AddReminderDialog(
            onDismiss = { showReminderDialog = false },
            onAdd = { model.createReminder(it); showReminderDialog = false },
        )
    }
    confirmation?.let {
        AlertDialog(
            onDismissRequest = { ConfirmationBroker.answer(false) }, containerColor = Color(0xFF0A0E1B),
            icon = { Icon(Icons.Default.Security, null, tint = Warning) }, title = { Text(it.title) },
            text = { Text(it.details, color = Color(0xFFBBC4D9)) },
            confirmButton = { TextButton(onClick = { ConfirmationBroker.answer(true) }) { Text("ALLOW ONCE", color = Cyan) } },
            dismissButton = { TextButton(onClick = { ConfirmationBroker.answer(false) }) { Text("DENY", color = Danger) } },
        )
    }
}

@Composable
private fun HomeDashboard(
    voice: String,
    color: Color,
    transcript: String,
    chat: List<ChatEntry>,
    reminders: List<ReminderItem>,
    memories: List<MemoryItem>,
    systemStatus: SystemStatus,
    onToggleVoice: () -> Unit,
    onChat: () -> Unit,
    onAddReminder: () -> Unit,
    onToggleReminder: (String, Boolean) -> Unit,
    onDeleteReminder: (String) -> Unit,
    onMemory: () -> Unit,
) {
    GlassCard(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("S h r e e", color = Cyan, fontSize = 27.sp, fontWeight = FontWeight.Light, letterSpacing = 5.sp)
            Text("YOUR AI COMPANION", color = Muted, fontSize = 9.sp, letterSpacing = 3.8.sp)
            Spacer(Modifier.height(18.dp))
            OrbConsole(voice, color, onToggleVoice)
            Spacer(Modifier.height(12.dp))
            Text(if (voice == "idle") "‹‹  CLICK TO ACTIVATE  ››" else voiceLabel(voice), color = color, fontSize = 9.sp, letterSpacing = 2.4.sp)
            Spacer(Modifier.height(10.dp))
            VoiceControl(voice, color, onToggleVoice)
            Spacer(Modifier.height(18.dp))
            DialogueCard(chat.lastOrNull(), transcript, onChat)
            Spacer(Modifier.height(10.dp))
            TimeCard(systemStatus)
            Spacer(Modifier.height(10.dp))
            RemindersCard(reminders, onAddReminder, onToggleReminder, onDeleteReminder)
            Spacer(Modifier.height(10.dp))
            MemoryCard(memories, onMemory)
            Spacer(Modifier.height(10.dp))
            SystemStatusCard(systemStatus)
        }
    }
}

@Composable
private fun OrbConsole(voice: String, color: Color, onToggle: () -> Unit) {
    val transition = rememberInfiniteTransition(label = "shree-orb")
    val pulse by transition.animateFloat(
        initialValue = .35f, targetValue = .95f,
        animationSpec = infiniteRepeatable(tween(if (voice == "idle") 2200 else 720), RepeatMode.Reverse), label = "orb-pulse",
    )
    Box(Modifier.size(252.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            drawCircle(Brush.radialGradient(listOf(color.copy(alpha = .20f * pulse), Color.Transparent)))
            drawCircle(color.copy(alpha = .75f), radius = size.minDimension * .43f, style = Stroke(2.dp.toPx()))
            drawCircle(Violet.copy(alpha = .72f * pulse), radius = size.minDimension * .40f, style = Stroke(3.dp.toPx()))
            drawArc(Cyan, -70f, 150f, false, topLeft = Offset(size.width * .11f, size.height * .11f), size = androidx.compose.ui.geometry.Size(size.width * .78f, size.height * .78f), style = Stroke(2.dp.toPx(), cap = StrokeCap.Round))
            drawOval(Cyan.copy(alpha = .32f), topLeft = Offset(size.width * .13f, size.height * .86f), size = androidx.compose.ui.geometry.Size(size.width * .74f, size.height * .08f), style = Stroke(1.dp.toPx()))
        }
        Image(painterResource(R.drawable.shree_mark), "SHREE", Modifier.size(158.dp), contentScale = ContentScale.Fit)
    }
}

@Composable
private fun DialogueCard(last: ChatEntry?, transcript: String, onClick: () -> Unit) {
    DashboardCard("CHAT WITH SHREE", Icons.Default.ChatBubbleOutline, Cyan, onClick = onClick) {
        val visible = transcript.ifBlank { last?.text ?: "Hey! I’m here. What’s on your mind?" }
        Text(if (last?.role == "user") "YOU" else "SHREE", color = if (last?.role == "user") Magenta else Cyan, fontSize = 9.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(7.dp))
        Text(visible, color = Color(0xFFE8EDFA), fontSize = 15.sp, lineHeight = 22.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun TimeCard(systemStatus: SystemStatus) {
    var now by remember { mutableStateOf(LocalDateTime.now()) }
    LaunchedEffect(Unit) { while (true) { now = LocalDateTime.now(); delay(1000) } }
    DashboardCard("TIME & CONNECTION", Icons.Default.AccessTime, Cyan) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(now.format(DateTimeFormatter.ofPattern("hh:mm a")), fontSize = 27.sp, color = Color.White)
                Text(now.format(DateTimeFormatter.ofPattern("EEEE, MMM d, yyyy")), fontSize = 11.sp, color = Muted)
            }
            Icon(Icons.Default.CloudQueue, null, tint = if (systemStatus.online) Cyan else Muted, modifier = Modifier.size(40.dp))
        }
    }
}

@Composable
private fun RemindersCard(
    reminders: List<ReminderItem>,
    onAdd: () -> Unit,
    onToggle: (String, Boolean) -> Unit,
    onDelete: (String) -> Unit,
) {
    val pending = reminders.count { !it.completed }
    DashboardCard("THINGS TO REMEMBER  ·  $pending PENDING", Icons.Default.FormatListBulleted, Cyan) {
        if (reminders.isEmpty()) Text("✓  No pending reminders", color = Muted, fontSize = 12.sp)
        reminders.take(4).forEach { reminder ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { onToggle(reminder.id, !reminder.completed) }, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Default.Check, null, tint = if (reminder.completed) Success else Muted, modifier = Modifier.size(17.dp))
                }
                Text(reminder.text, Modifier.weight(1f), color = if (reminder.completed) Muted else Color(0xFFDCE3F4), fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                IconButton(onClick = { onDelete(reminder.id) }, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Default.DeleteOutline, "Delete reminder", tint = Danger.copy(alpha = .8f), modifier = Modifier.size(17.dp))
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).border(1.dp, Violet.copy(alpha = .28f), RoundedCornerShape(13.dp))
                .clickable(onClick = onAdd).padding(13.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Default.Add, null, tint = Violet, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(8.dp))
            Text("Add New Reminder", color = Color(0xFF9EA7FF), fontSize = 12.sp)
        }
    }
}

@Composable
private fun MemoryCard(memories: List<MemoryItem>, onClick: () -> Unit) {
    DashboardCard("MEMORY STATUS  ·  ${memories.size} STORED", Icons.Default.Psychology, Cyan, onClick = onClick) {
        Canvas(Modifier.fillMaxWidth().height(82.dp)) {
            val step = size.width / 22f
            val cyanPath = androidx.compose.ui.graphics.Path()
            val pinkPath = androidx.compose.ui.graphics.Path()
            repeat(23) { i ->
                val x = i * step
                val y1 = size.height * (.52f + .12f * sin(i * .46f))
                val y2 = size.height * (.55f + .15f * sin(i * .39f + 2.1f))
                if (i == 0) { cyanPath.moveTo(x, y1); pinkPath.moveTo(x, y2) } else { cyanPath.lineTo(x, y1); pinkPath.lineTo(x, y2) }
            }
            drawPath(cyanPath, Cyan, style = Stroke(2.dp.toPx()))
            drawPath(pinkPath, Magenta, style = Stroke(2.dp.toPx()))
        }
        Text(if (memories.isEmpty()) "No memories stored yet" else "Memory synchronized with desktop SHREE", color = Muted, fontSize = 10.sp)
    }
}

@Composable
private fun SystemStatusCard(systemStatus: SystemStatus) {
    DashboardCard("SYSTEM STATUS", Icons.Default.Memory, Magenta) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(10.dp).background(if (systemStatus.online) Success else Warning, CircleShape)); Spacer(Modifier.width(12.dp))
            Text(systemStatus.label, color = Color(0xFFDCE3F4), fontSize = 13.sp)
        }
    }
}

@Composable
private fun ChatScreen(chat: List<ChatEntry>, transcript: String, onSend: (String) -> Unit) {
    var message by remember { mutableStateOf("") }
    SectionTitle("CHAT WITH SHREE", "Conversation synchronized from your active session")
    if (chat.isEmpty() && transcript.isBlank()) EmptyPanel("Type below or start a voice conversation.")
    chat.takeLast(30).forEach { entry ->
        GlassCard(Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
            Column(Modifier.padding(15.dp)) {
                Text(if (entry.role == "user") "YOU" else "SHREE", color = if (entry.role == "user") Magenta else Cyan, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(6.dp)); Text(entry.text, color = Color(0xFFE8EDFA), fontSize = 13.sp, lineHeight = 19.sp)
            }
        }
    }
    Spacer(Modifier.height(10.dp))
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            value = message, onValueChange = { message = it }, modifier = Modifier.weight(1f),
            label = { Text("Message Shree") }, maxLines = 4,
        )
        Spacer(Modifier.width(8.dp))
        Button(onClick = { val value = message.trim(); if (value.isNotEmpty()) { onSend(value); message = "" } }) { Text("SEND") }
    }
}

@Composable
private fun VoiceScreen(voice: String, color: Color, transcript: String, onToggle: () -> Unit) {
    SectionTitle("VOICE", "Full voice conversation through your paired SHREE desktop")
    Spacer(Modifier.height(18.dp)); OrbConsole(voice, color, onToggle); Spacer(Modifier.height(18.dp))
    DialogueConsole(voice, transcript); Spacer(Modifier.height(20.dp)); VoiceControl(voice, color, onToggle)
}

@Composable
private fun MemoryScreen(memories: List<MemoryItem>) {
    SectionTitle("MEMORY", "The same long-term memories stored by desktop SHREE")
    if (memories.isEmpty()) EmptyPanel("No memories stored yet.")
    memories.forEach { memory ->
        GlassCard(Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
            Column(Modifier.padding(15.dp)) {
                Row(Modifier.fillMaxWidth()) {
                    Text(memory.category.uppercase(), Modifier.weight(1f), color = Cyan, fontSize = 9.sp, letterSpacing = 1.sp)
                    if (memory.pinned) Text("PINNED", color = Magenta, fontSize = 8.sp)
                }
                Spacer(Modifier.height(7.dp)); Text(memory.content, color = Color(0xFFE8EDFA), fontSize = 13.sp, lineHeight = 19.sp)
            }
        }
    }
}

@Composable
private fun BottomNavigation(selected: MobileSection, onSelect: (MobileSection) -> Unit) {
    val items = listOf(
        Triple(MobileSection.Home, Icons.Default.Home, "Home"), Triple(MobileSection.Chat, Icons.Default.ChatBubbleOutline, "Chat"),
        Triple(MobileSection.Voice, Icons.Default.Mic, "Voice"), Triple(MobileSection.Memory, Icons.Default.Psychology, "Memory"),
        Triple(MobileSection.Settings, Icons.Default.Settings, "Settings"),
    )
    GlassCard(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 10.dp), horizontalArrangement = Arrangement.SpaceAround) {
            items.forEach { (section, icon, label) ->
                val active = section == selected
                Column(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).clickable { onSelect(section) }.padding(vertical = 7.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(icon, label, tint = if (active) Cyan else Muted, modifier = Modifier.size(23.dp)); Spacer(Modifier.height(5.dp))
                    Text(label, color = if (active) Cyan else Muted, fontSize = 9.sp)
                }
            }
        }
    }
}

@Composable
private fun DashboardCard(title: String, icon: androidx.compose.ui.graphics.vector.ImageVector, tint: Color, onClick: (() -> Unit)? = null, content: @Composable () -> Unit) {
    GlassCard(Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)) {
        Column(Modifier.padding(15.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Icon(icon, null, tint = tint, modifier = Modifier.size(19.dp)); Spacer(Modifier.width(9.dp)); Text(title, color = Color(0xFF9DA9C3), fontSize = 9.sp, letterSpacing = 1.25.sp, fontWeight = FontWeight.Bold) }
            Spacer(Modifier.height(13.dp)); content()
        }
    }
}

@Composable
private fun SectionTitle(title: String, subtitle: String) {
    Column(Modifier.fillMaxWidth()) { Text(title, color = Cyan, fontSize = 16.sp, letterSpacing = 2.sp); Spacer(Modifier.height(5.dp)); Text(subtitle, color = Muted, fontSize = 11.sp) }
    Spacer(Modifier.height(14.dp))
}

@Composable private fun EmptyPanel(text: String) { GlassCard(Modifier.fillMaxWidth()) { Text(text, Modifier.padding(18.dp), color = Muted, fontSize = 12.sp) } }

@Composable
private fun AddReminderDialog(onDismiss: () -> Unit, onAdd: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss, containerColor = Color(0xFF0A0E1B), title = { Text("Add reminder") },
        text = { OutlinedTextField(value = text, onValueChange = { text = it }, label = { Text("What should Shree remember?") }, singleLine = false) },
        confirmButton = { TextButton(enabled = text.isNotBlank(), onClick = { onAdd(text) }) { Text("ADD", color = Cyan) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("CANCEL", color = Muted) } },
    )
}

@Composable
private fun FuturisticBackground(accent: Color) {
    Canvas(Modifier.fillMaxSize()) {
        drawRect(Brush.radialGradient(listOf(accent.copy(alpha = .11f), Color.Transparent), center = Offset(size.width * .5f, size.height * .32f), radius = size.width * .8f))
        val step = 42.dp.toPx()
        var x = 0f; while (x < size.width) { drawLine(Cyan.copy(alpha = .03f), Offset(x, 0f), Offset(x, size.height), 1f); x += step }
        var y = 0f; while (y < size.height) { drawLine(Violet.copy(alpha = .03f), Offset(0f, y), Offset(size.width, y), 1f); y += step }
    }
}

@Composable
private fun ShreeHeader(link: String, paired: Boolean, onSettings: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Image(painterResource(R.drawable.shree_mark), "SHREE", Modifier.size(52.dp), contentScale = ContentScale.Fit)
        Spacer(Modifier.width(11.dp)); Column(Modifier.weight(1f)) {
            Text("S h r e e", color = Cyan, fontSize = 20.sp, fontWeight = FontWeight.Light, letterSpacing = 2.5.sp)
            Text("M A R K  1 2", color = Magenta, fontSize = 8.sp, letterSpacing = 2.4.sp)
        }
        val connected = paired && link == "connected"
        Row(Modifier.clip(RoundedCornerShape(50)).background((if (connected) Success else Warning).copy(alpha = .08f)).border(1.dp, (if (connected) Success else Warning).copy(alpha = .25f), RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(7.dp).background(if (connected) Success else Warning, CircleShape)); Spacer(Modifier.width(6.dp)); Text(if (connected) "ONLINE" else "OFFLINE", fontSize = 8.sp, letterSpacing = 1.2.sp, color = if (connected) Cyan else Warning)
        }
        Spacer(Modifier.width(6.dp)); IconButton(onClick = onSettings, modifier = Modifier.border(1.dp, Color.White.copy(alpha = .1f), CircleShape)) { Icon(Icons.Default.Settings, "Settings", tint = Color(0xFFD4DBED)) }
    }
}

@Composable
private fun PairingConsole(setup: String, onScan: () -> Unit) {
    GlassCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("SECURE DEVICE LINK", color = Cyan, fontSize = 10.sp, letterSpacing = 2.sp); Spacer(Modifier.height(22.dp))
        Box(Modifier.size(190.dp), contentAlignment = Alignment.Center) { Canvas(Modifier.fillMaxSize()) { drawCircle(Cyan.copy(alpha = .08f)); drawCircle(Cyan.copy(alpha = .4f), style = Stroke(1.dp.toPx())); drawCircle(Magenta.copy(alpha = .25f), radius = size.minDimension * .42f, style = Stroke(1.dp.toPx())) }; Image(painterResource(R.drawable.shree_mark), "SHREE", Modifier.size(132.dp)) }
        Spacer(Modifier.height(18.dp)); Text(setup, textAlign = TextAlign.Center, color = Color(0xFFC7D0E6), fontSize = 13.sp, lineHeight = 20.sp); Spacer(Modifier.height(20.dp))
        Button(onClick = onScan, shape = RoundedCornerShape(12.dp), colors = ButtonDefaults.buttonColors(containerColor = Cyan, contentColor = Night)) { Icon(Icons.Default.QrCodeScanner, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("SCAN PAIRING CODE", fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = .8.sp) }
        Spacer(Modifier.height(12.dp)); Text("PC connected to this phone’s hotspot is supported", color = Muted, fontSize = 9.sp)
    } }
}

@Composable
private fun DialogueConsole(voice: String, transcript: String) {
    GlassCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) { Box(Modifier.size(6.dp).background(if (voice.startsWith("error")) Danger else Cyan, CircleShape)); Spacer(Modifier.width(8.dp)); Text("DIALOGUE STREAM", color = Muted, fontSize = 9.sp, letterSpacing = 1.6.sp) }
        Spacer(Modifier.height(12.dp)); when { voice.startsWith("error") -> Text(voice.substringAfter(":").trim(), color = Color(0xFFFFA6B5), fontSize = 12.sp, lineHeight = 18.sp); transcript.isBlank() -> Text("Tap the voice core and speak naturally.", color = Color(0xFF9BA8C4), fontSize = 12.sp); else -> Text(transcript, color = Color(0xFFE8EDFA), fontSize = 13.sp, lineHeight = 19.sp, maxLines = 5, overflow = TextOverflow.Ellipsis) }
    } }
}

@Composable
private fun VoiceControl(voice: String, color: Color, onToggle: () -> Unit) {
    val active = voice != "idle" && !voice.startsWith("error")
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Row(verticalAlignment = Alignment.CenterVertically) { SignalBars(active, color, .55f); Spacer(Modifier.width(8.dp)); Box(Modifier.size(72.dp).shadow(24.dp, CircleShape, ambientColor = color, spotColor = color).background(Brush.radialGradient(listOf(color, color.copy(alpha = .42f), Night)), CircleShape).border(1.dp, color.copy(alpha = .8f), CircleShape).clickable(onClick = onToggle), contentAlignment = Alignment.Center) { Icon(Icons.Default.Mic, if (active) "Microphone on" else "Start voice", tint = Color.White, modifier = Modifier.size(30.dp)) }; Spacer(Modifier.width(8.dp)); SignalBars(active, color, .15f) }
        Spacer(Modifier.height(10.dp)); Text(if (active) "TAP TO END SESSION" else "TAP TO SPEAK OR JUST TALK…", color = color, fontSize = 9.sp, letterSpacing = 1.4.sp)
    }
}

@Composable
private fun SignalBars(active: Boolean, color: Color, phase: Float) {
    Canvas(Modifier.width(75.dp).height(24.dp)) { val count = 13; val gap = size.width / count; repeat(count) { index -> val wave = if (active) (.25f + .75f * abs(sin(index * .62f + phase * 8f))) else .14f; val half = size.height * wave * .5f; drawLine(color.copy(alpha = .85f), Offset(gap * index + gap / 2, size.height / 2 - half), Offset(gap * index + gap / 2, size.height / 2 + half), 2.dp.toPx(), StrokeCap.Round) } }
}

@Composable
private fun SystemTools(onPermissions: () -> Unit, onPhoneControl: () -> Unit, onNotifications: () -> Unit, onRefresh: () -> Unit, onUnpair: () -> Unit) {
    SectionTitle("SETTINGS", "Manage this Android companion")
    Column(Modifier.fillMaxWidth()) {
        ToolTile("PERMISSIONS", Icons.Default.AdminPanelSettings, Cyan, Modifier.fillMaxWidth(), onPermissions); Spacer(Modifier.height(10.dp))
        ToolTile("PHONE CONTROL", Icons.Default.PhoneAndroid, Violet, Modifier.fillMaxWidth(), onPhoneControl); Spacer(Modifier.height(10.dp))
        ToolTile("NOTIFICATIONS", Icons.Default.NotificationsActive, Magenta, Modifier.fillMaxWidth(), onNotifications); Spacer(Modifier.height(10.dp))
        ToolTile("REFRESH SHARED DATA", Icons.Default.Memory, Success, Modifier.fillMaxWidth(), onRefresh); Spacer(Modifier.height(10.dp))
        ToolTile("UNPAIR", Icons.Default.LinkOff, Danger, Modifier.fillMaxWidth(), onUnpair)
    }
}

@Composable
private fun ToolTile(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, tint: Color, modifier: Modifier, onClick: () -> Unit) {
    Box(modifier.height(66.dp).clip(RoundedCornerShape(14.dp)).background(Panel).border(1.dp, tint.copy(alpha = .16f), RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(14.dp)) { Row(verticalAlignment = Alignment.CenterVertically) { Icon(icon, label, tint = tint, modifier = Modifier.size(21.dp)); Spacer(Modifier.width(13.dp)); Text(label, color = Color(0xFFB7C2DA), fontSize = 9.sp, letterSpacing = .8.sp) } }
}

@Composable
private fun GlassCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Card(modifier, shape = RoundedCornerShape(22.dp), colors = CardDefaults.cardColors(containerColor = Panel), border = androidx.compose.foundation.BorderStroke(1.dp, Brush.linearGradient(listOf(Cyan.copy(alpha = .18f), Magenta.copy(alpha = .13f), Color.White.copy(alpha = .04f))))) { content() }
}

private fun voiceLabel(voice: String): String = when {
    voice.startsWith("error") -> "VOICE LINK ERROR"
    voice == "listening" -> "LISTENING"
    voice == "speaking" -> "SHREE IS SPEAKING"
    voice == "connecting" -> "ESTABLISHING LIVE LINK"
    else -> "VOICE CORE READY"
}
