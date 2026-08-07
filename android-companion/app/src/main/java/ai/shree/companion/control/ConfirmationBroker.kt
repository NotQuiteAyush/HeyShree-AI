package ai.shree.companion.control

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withTimeoutOrNull

data class PendingConfirmation(val title: String, val details: String, internal val response: CompletableDeferred<Boolean>)

object ConfirmationBroker {
    val pending = MutableStateFlow<PendingConfirmation?>(null)
    suspend fun request(title: String, details: String): Boolean {
        val response = CompletableDeferred<Boolean>()
        pending.value = PendingConfirmation(title, details, response)
        val answer = withTimeoutOrNull(60_000) { response.await() } ?: false
        pending.compareAndSet(pending.value, null)
        return answer
    }
    fun answer(approved: Boolean) {
        pending.value?.response?.complete(approved)
        pending.value = null
    }
}
