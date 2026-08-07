package ai.shree.companion.control

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityEvent

class ShreeAccessibilityService : AccessibilityService() {
    companion object {
        @Volatile var instance: ShreeAccessibilityService? = null
    }
    override fun onServiceConnected() { instance = this }
    override fun onDestroy() { instance = null; super.onDestroy() }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit

    fun clickText(text: String): Boolean {
        val nodes = rootInActiveWindow?.findAccessibilityNodeInfosByText(text).orEmpty()
        return nodes.firstOrNull { it.isClickable }?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
    }

    fun typeText(text: String): Boolean {
        val focused = rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
        return focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        })
    }

    fun tap(x: Float, y: Float, done: (Boolean) -> Unit) {
        val path = Path().apply { moveTo(x, y) }
        dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, 60)).build(),
            object : GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) = done(true)
                override fun onCancelled(gestureDescription: GestureDescription?) = done(false)
            }, null)
    }
}
